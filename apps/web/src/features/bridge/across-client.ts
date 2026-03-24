import { createAcrossClient } from "@across-protocol/app-sdk";
import type { ChainSlug } from "@chainatlas/shared";
import {
  concat,
  encodeFunctionData,
  formatEther,
  isAddress,
  isHex,
  padHex,
  parseAbi,
  parseUnits,
} from "viem";
import { base, baseSepolia, mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";
import {
  createChainPublicClient,
  createPrivyWalletClient,
  type ConnectedPrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { env } from "@/lib/config/env";
import { runtimeConfig, runtimeProfile } from "@/lib/config/runtime";

type AcrossProgress = {
  step: string;
  status: string;
  depositId?: string | number | bigint;
  txReceipt?: { transactionHash?: string };
  fillTxTimestamp?: number;
  actionSuccess?: boolean;
};

type AcrossStatusResponse = {
  status?: string;
  fillTxHash?: string;
  expectedFillTimeSec?: number;
  expectedFillTime?: number;
  reason?: string;
  message?: string;
};

type BridgeQuoteInput = {
  sourceChain: ChainSlug;
  destinationChain: ChainSlug;
  assetAddress: string | "native";
  amount: string;
  recipient: `0x${string}`;
};

type ManualAcrossDepositInput = {
  accountAddress: `0x${string}`;
  client: ReturnType<typeof getAcrossClient>;
  deposit: Awaited<ReturnType<typeof quoteAcrossBridge>>["deposit"];
  sourcePublicClient: ReturnType<typeof createChainPublicClient>;
  wallet: ConnectedPrivyWallet;
};

const DEPOSIT_ABI = parseAbi([
  "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
]);
const APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const MAX_UINT256 = (1n << 256n) - 1n;
const DOMAIN_CALLDATA_DELIMITER = "0x1dc0de";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      (typeof record.message === "string" && record.message) ||
      (typeof record.shortMessage === "string" && record.shortMessage) ||
      (typeof record.details === "string" && record.details);
    if (message) {
      return message;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function extractRpcUrl(message: string) {
  const match = message.match(/URL:\s*(https?:\/\/[^\s]+)/i);
  return match?.[1];
}

function normalizeRpcFailureMessage(message: string, sourceChain: ChainSlug) {
  const lowered = message.toLowerCase();
  const isRpcFailure =
    lowered.includes("http request failed") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("network request failed");

  if (!isRpcFailure) {
    return undefined;
  }

  const rpcUrl = extractRpcUrl(message);
  const envKey =
    sourceChain === "ethereum"
      ? "VITE_ETHEREUM_RPC_URL"
      : sourceChain === "base"
        ? "VITE_BASE_RPC_URL"
        : runtimeProfile === "testnet"
          ? "VITE_POLYGON_AMOY_RPC_URL"
          : "VITE_POLYGON_RPC_URL";
  const endpoint = rpcUrl ? `RPC endpoint ${rpcUrl} is not reachable.` : "RPC endpoint is not reachable.";

  return `${endpoint} Set ${envKey} to a reliable ${sourceChain} endpoint and retry bridge.`;
}

function normalizeGasAllowanceErrorMessage(message: string, sourceChain: ChainSlug) {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("gas required exceeds allowance") ||
    lowered.includes("insufficient funds") ||
    lowered.includes("intrinsic gas too low")
  ) {
    return `Bridge transaction could not estimate gas on ${sourceChain}. Ensure wallet has enough native gas token and retry.`;
  }
  return undefined;
}

function isRpcMethodUnavailable(message: string) {
  const lowered = message.toLowerCase();
  const mentionsUnsupportedMethod =
    lowered.includes("eth_filltransaction") ||
    lowered.includes("eth_maxpriorityfeepergas");
  const unsupportedSignal =
    lowered.includes("does not exist") ||
    lowered.includes("not available") ||
    lowered.includes("method not found");
  return mentionsUnsupportedMethod && unsupportedSignal;
}

function formatNativeBalanceHint(
  amount: bigint,
  symbol: string,
) {
  const formatted = Number(formatEther(amount));
  if (Number.isFinite(formatted)) {
    return `${formatted.toFixed(6)} ${symbol}`;
  }
  return `${formatEther(amount)} ${symbol}`;
}

function addressToBytes32(address: `0x${string}`) {
  if (!isHex(address)) {
    throw new Error("Invalid hex input");
  }
  if (address.length === 66) {
    return address;
  }
  if (!isAddress(address)) {
    throw new Error("Invalid address");
  }
  return padHex(address, { dir: "left", size: 32 });
}

function getIntegratorDataSuffix(integratorId: string) {
  if (!isHex(integratorId) || integratorId.length !== 6) {
    return undefined;
  }
  return concat([DOMAIN_CALLDATA_DELIMITER, integratorId as `0x${string}`]);
}

function bigintToHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function getErrorMessageSafe(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function estimateGasWithFallback(
  estimateFn: () => Promise<bigint>,
  fallbackGas: bigint,
) {
  try {
    return await estimateFn();
  } catch {
    return fallbackGas;
  }
}

async function sendTransactionViaProvider(input: {
  wallet: ConnectedPrivyWallet;
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}): Promise<`0x${string}`> {
  const provider = await input.wallet.getEthereumProvider();
  const tx = {
    from: input.from,
    to: input.to,
    data: input.data,
    value: bigintToHex(input.value ?? 0n),
    ...(typeof input.gas === "bigint" ? { gas: bigintToHex(input.gas) } : {}),
  };

  try {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [tx],
    });
    if (typeof hash !== "string" || !hash.startsWith("0x")) {
      throw new Error("Wallet provider did not return a transaction hash");
    }
    return hash as `0x${string}`;
  } catch (error) {
    const lowered = getErrorMessageSafe(error).toLowerCase();
    if (
      lowered.includes("not enough input to decode") ||
      lowered.includes("invalid parameters")
    ) {
      throw new Error(
        "Wallet rejected transaction payload. Disable Smart Transactions in MetaMask and retry bridge once.",
      );
    }
    throw error;
  }
}

function shouldUseManualWalletFallback(message: string) {
  const lowered = message.toLowerCase();
  return (
    isRpcMethodUnavailable(message) ||
    lowered.includes("insufficient eth for gas") ||
    lowered.includes("gas required exceeds allowance") ||
    lowered.includes("insufficient funds") ||
    lowered.includes("intrinsic gas too low")
  );
}

function isMethodUnsupportedError(error: unknown, methodName: string) {
  const message = getErrorMessageSafe(error).toLowerCase();
  return (
    message.includes(methodName.toLowerCase()) &&
    (message.includes("does not exist") ||
      message.includes("not available") ||
      message.includes("method not found") ||
      message.includes("not supported"))
  );
}

async function executeAcrossDepositManually(
  input: ManualAcrossDepositInput,
  onProgress?: (progress: AcrossProgress) => void,
) {
  let depositId: string | undefined;
  let originTxHash: `0x${string}` | undefined;
  const { accountAddress, deposit, sourcePublicClient, wallet } = input;

  if (!deposit.isNative) {
    const allowance = await sourcePublicClient.readContract({
      address: deposit.inputToken,
      abi: APPROVE_ABI,
      functionName: "allowance",
      args: [accountAddress, deposit.spokePoolAddress],
    });
    if (allowance < deposit.inputAmount) {
      const approveGas = await estimateGasWithFallback(
        async () =>
          await sourcePublicClient.estimateGas({
            account: accountAddress,
            to: deposit.inputToken,
            data: encodeFunctionData({
              abi: APPROVE_ABI,
              functionName: "approve",
              args: [deposit.spokePoolAddress, MAX_UINT256],
            }),
            value: 0n,
          }),
        150_000n,
      );
      const approveData = encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: "approve",
        args: [deposit.spokePoolAddress, MAX_UINT256],
      });
      onProgress?.({ step: "approve", status: "txPending" });
      const approveHash = await sendTransactionViaProvider({
        wallet,
        from: accountAddress,
        to: deposit.inputToken,
        data: approveData,
        gas: approveGas,
      });
      await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash });
      onProgress?.({
        step: "approve",
        status: "txSuccess",
        txReceipt: { transactionHash: approveHash },
      });
    }
  }

  const depositData = encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: "deposit",
    args: [
      addressToBytes32(accountAddress),
      addressToBytes32(deposit.recipient),
      addressToBytes32(deposit.inputToken),
      addressToBytes32(deposit.outputToken),
      deposit.inputAmount,
      deposit.outputAmount,
      BigInt(deposit.destinationChainId),
      addressToBytes32(deposit.exclusiveRelayer),
      deposit.quoteTimestamp,
      deposit.fillDeadline,
      deposit.exclusivityDeadline,
      deposit.message,
    ],
  });
  const dataSuffix = getIntegratorDataSuffix(env.acrossIntegratorId);
  const bridgedData = dataSuffix ? concat([depositData, dataSuffix]) : depositData;
  const depositGas = await estimateGasWithFallback(
    async () =>
      await sourcePublicClient.estimateGas({
        account: accountAddress,
        to: deposit.spokePoolAddress,
        data: bridgedData,
        value: deposit.isNative ? deposit.inputAmount : 0n,
      }),
    900_000n,
  );

  onProgress?.({ step: "deposit", status: "txPending" });
  originTxHash = await sendTransactionViaProvider({
    wallet,
    from: accountAddress,
    to: deposit.spokePoolAddress,
    data: bridgedData,
    value: deposit.isNative ? deposit.inputAmount : 0n,
    gas: depositGas,
  });

  const depositStatus = await (input.client as any).waitForDepositTx({
    originChainId: deposit.originChainId,
    transactionHash: originTxHash,
    publicClient: sourcePublicClient,
  });
  if (depositStatus?.depositId !== undefined) {
    depositId = String(depositStatus.depositId);
  }
  onProgress?.({
    step: "deposit",
    status: "txSuccess",
    depositId,
    txReceipt: { transactionHash: originTxHash },
  });

  return {
    depositId,
    originTxHash,
  };
}

function getAcrossChains() {
  const resolveChain = (chainId: number) => {
    if (chainId === mainnet.id) return mainnet;
    if (chainId === base.id) return base;
    if (chainId === polygon.id) return polygon;
    if (chainId === sepolia.id) return sepolia;
    if (chainId === baseSepolia.id) return baseSepolia;
    if (chainId === polygonAmoy.id) return polygonAmoy;
    return undefined;
  };

  const ethereum = resolveChain(runtimeConfig.chains.ethereum.chainId);
  const baseChain = resolveChain(runtimeConfig.chains.base.chainId);
  const polygonChain = resolveChain(runtimeConfig.chains.polygon.chainId);
  if (!ethereum || !baseChain || !polygonChain) {
    throw new Error("Across client chain config is invalid");
  }
  return [ethereum, baseChain, polygonChain];
}

function getAcrossClient() {
  return createAcrossClient({
    integratorId: env.acrossIntegratorId,
    chains: getAcrossChains(),
    useTestnet: runtimeProfile === "testnet",
  });
}

export async function quoteAcrossBridge(input: BridgeQuoteInput) {
  const client = getAcrossClient();
  const originChainId = runtimeConfig.chains[input.sourceChain].chainId;
  const destinationChainId = runtimeConfig.chains[input.destinationChain].chainId;
  if (!Number.isInteger(originChainId) || originChainId <= 0) {
    throw new Error(`Across bridge source chain id is invalid: ${originChainId}`);
  }
  if (!Number.isInteger(destinationChainId) || destinationChainId <= 0) {
    throw new Error(`Across bridge destination chain id is invalid: ${destinationChainId}`);
  }

  let availableRoutes: any[];
  try {
    availableRoutes = await client.getAvailableRoutes({
      originChainId,
      destinationChainId,
      apiUrl: runtimeConfig.bridge.apiBaseUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Across route lookup failed: ${message}`);
  }
  const sourceToken = runtimeConfig.bridge.supportedAssets.find((asset) => {
    if (asset.chain !== input.sourceChain) {
      return false;
    }
    return asset.address.toLowerCase() === input.assetAddress.toLowerCase();
  });
  if (!sourceToken) {
    throw new Error("Selected token is not bridgeable on source chain");
  }

  const destinationTokenAddresses = runtimeConfig.bridge.supportedAssets
    .filter((asset) => asset.chain === input.destinationChain && asset.symbol === sourceToken.symbol)
    .map((asset) => asset.address)
    .filter((address): address is string => address !== "native")
    .map((address) => address.toLowerCase());
  const hasDestinationTokenFilter = destinationTokenAddresses.length > 0;

  const matchedRoute = availableRoutes.find((route: any) => {
    if (sourceToken.address === "native") {
      return route.isNative === true;
    }
    return (
      route.inputToken.toLowerCase() === sourceToken.address.toLowerCase() &&
      (!hasDestinationTokenFilter ||
        destinationTokenAddresses.includes(route.outputToken.toLowerCase()))
    );
  });

  if (!matchedRoute) {
    throw new Error(
      `Across has no available route for ${sourceToken.symbol} on ${input.sourceChain} -> ${input.destinationChain}`,
    );
  }

  try {
    return await client.getQuote({
      route: {
        originChainId,
        destinationChainId,
        inputToken: matchedRoute.inputToken as `0x${string}`,
        outputToken: matchedRoute.outputToken as `0x${string}`,
        isNative: Boolean(matchedRoute.isNative),
      },
      inputAmount: parseUnits(input.amount, sourceToken.decimals ?? 18),
      recipient: input.recipient,
      apiUrl: runtimeConfig.bridge.apiBaseUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("destinationChainId")) {
      throw new Error(
        `Across quote rejected destination chain id (${destinationChainId}) for route ${originChainId} -> ${destinationChainId}: ${errorMessage}`,
      );
    }
    if (errorMessage.includes("inputToken") || errorMessage.includes("outputToken")) {
      throw new Error(
        `Across route rejected token pair ${matchedRoute.inputToken} -> ${matchedRoute.outputToken}: ${errorMessage}`,
      );
    }
    if (errorMessage.toLowerCase().includes("failed to fetch")) {
      throw new Error("Across API request failed. Check network connectivity and RPC settings.");
    }
    throw error;
  }
}

export async function executeAcrossBridge(
  wallet: ConnectedPrivyWallet,
  input: BridgeQuoteInput,
  onProgress?: (progress: AcrossProgress) => void,
  quoteOverride?: Awaited<ReturnType<typeof quoteAcrossBridge>>,
) {
  const quote = quoteOverride ?? (await quoteAcrossBridge(input));
  const client = getAcrossClient();
  const walletClient = await createPrivyWalletClient(wallet, input.sourceChain);
  const sourcePublicClient = createChainPublicClient(input.sourceChain);
  if (!walletClient.account) {
    throw new Error("Privy wallet account is unavailable");
  }
  const accountAddress = walletClient.account.address as `0x${string}`;
  const nativeSymbol = sourcePublicClient.chain?.nativeCurrency.symbol ?? "native";

  let depositId: string | undefined;
  let originTxHash: `0x${string}` | undefined;
  const provider = await wallet.getEthereumProvider();
  let manualFirst = false;
  try {
    await provider.request({ method: "eth_maxPriorityFeePerGas" });
  } catch (error) {
    if (isMethodUnsupportedError(error, "eth_maxPriorityFeePerGas")) {
      manualFirst = true;
    }
  }
  try {
    const nativeBalance = await sourcePublicClient.getBalance({
      address: accountAddress,
    });
    if (nativeBalance === 0n) {
      manualFirst = true;
    }
  } catch {
    // Ignore balance precheck failures.
  }

  if (manualFirst) {
    const manual = await executeAcrossDepositManually(
      {
        accountAddress,
        client,
        deposit: quote.deposit,
        sourcePublicClient,
        wallet,
      },
      onProgress,
    );
    return {
      quote,
      depositId: manual.depositId,
      originTxHash: manual.originTxHash,
    };
  }

  try {
    await client.executeQuote({
      walletClient,
      deposit: quote.deposit,
      forceOriginChain: true,
      infiniteApproval: true,
      onProgress: (progress: AcrossProgress) => {
        onProgress?.(progress);

        if (progress.step === "deposit" && progress.status === "txSuccess") {
          if (progress.depositId !== undefined) {
            depositId = String(progress.depositId);
          }
          if (progress.txReceipt?.transactionHash?.startsWith("0x")) {
            originTxHash = progress.txReceipt.transactionHash as `0x${string}`;
          }
        }
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const useManualFallback = shouldUseManualWalletFallback(message);
    if (useManualFallback) {
      try {
        const manual = await executeAcrossDepositManually(
          {
            accountAddress,
            client,
            deposit: quote.deposit,
            sourcePublicClient,
            wallet,
          },
          onProgress,
        );
        depositId = manual.depositId;
        originTxHash = manual.originTxHash;
        return {
          quote,
          depositId,
          originTxHash,
        };
      } catch (manualError) {
        const manualMessage = getErrorMessage(manualError);
        if (isRpcMethodUnavailable(manualMessage)) {
          throw new Error(
            `Wallet RPC on ${input.sourceChain} does not support required transaction methods (eth_fillTransaction / eth_maxPriorityFeePerGas). In MetaMask, switch to a standard ${input.sourceChain} RPC endpoint and retry.`,
          );
        }
        if (normalizeGasAllowanceErrorMessage(manualMessage, input.sourceChain)) {
          let nativeBalanceHint = "";
          try {
            const nativeBalance = await sourcePublicClient.getBalance({
              address: accountAddress,
            });
            nativeBalanceHint = ` Current ${input.sourceChain} gas balance: ${formatNativeBalanceHint(nativeBalance, nativeSymbol)}.`;
          } catch {
            // Best effort only.
          }
          throw new Error(
            `Insufficient ${nativeSymbol} for gas on ${input.sourceChain}.${nativeBalanceHint} Add native gas token and retry.`,
          );
        }
        throw new Error(`Across bridge submission failed: ${manualMessage}`);
      }
    }
    const rpcFailureMessage = normalizeRpcFailureMessage(message, input.sourceChain);
    const gasFailureMessage = normalizeGasAllowanceErrorMessage(
      message,
      input.sourceChain,
    );
    if (rpcFailureMessage) {
      throw new Error(rpcFailureMessage);
    }
    if (gasFailureMessage) {
      let nativeBalanceHint = "";
      try {
        const nativeBalance = await sourcePublicClient.getBalance({
          address: accountAddress,
        });
        nativeBalanceHint = ` Current ${input.sourceChain} gas balance: ${formatNativeBalanceHint(nativeBalance, nativeSymbol)}.`;
      } catch {
        // Best effort only.
      }
      if (message.toLowerCase().includes("gas required exceeds allowance")) {
        throw new Error(
          `Insufficient ${nativeSymbol} for gas on ${input.sourceChain}.${nativeBalanceHint} Add native gas token and retry.`,
        );
      }
      throw new Error(`${gasFailureMessage}${nativeBalanceHint}`);
    }
    if (message.toLowerCase().includes("not enough input to decode")) {
      throw new Error(
        "Across bridge submission failed while encoding wallet transaction. Reconnect wallet and retry once.",
      );
    }
    throw new Error(`Across bridge submission failed: ${message}`);
  }

  return {
    quote,
    depositId,
    originTxHash,
  };
}

export async function fetchAcrossDepositStatus(input: {
  originChainId: number;
  depositId: string;
  apiBaseUrl?: string;
}): Promise<AcrossStatusResponse> {
  const baseUrl = (input.apiBaseUrl || runtimeConfig.bridge.apiBaseUrl).replace(/\/$/, "");
  const url = new URL(`${baseUrl}/deposit/status`);
  url.searchParams.set("originChainId", String(input.originChainId));
  url.searchParams.set("depositId", input.depositId);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Across status lookup failed: ${response.status}`);
  }

  return (await response.json()) as AcrossStatusResponse;
}
