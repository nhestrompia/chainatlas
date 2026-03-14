import { createAcrossClient } from "@across-protocol/app-sdk";
import type { ChainSlug } from "@chainatlas/shared";
import { concat, encodeFunctionData, isAddress, isHex, padHex, parseAbi, parseUnits } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
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

const DEPOSIT_ABI = parseAbi([
  "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
]);
const APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const DOMAIN_CALLDATA_DELIMITER = "0x1dc0de";

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
  const envKey = sourceChain === "ethereum" ? "VITE_ETHEREUM_RPC_URL" : "VITE_BASE_RPC_URL";
  const endpoint = rpcUrl ? `RPC endpoint ${rpcUrl} is not reachable.` : "RPC endpoint is not reachable.";

  return `${endpoint} Set ${envKey} to a reliable ${sourceChain} endpoint and retry bridge.`;
}

function bigintToHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

async function sendTransactionViaProvider(input: {
  wallet: ConnectedPrivyWallet;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}): Promise<`0x${string}`> {
  const provider = await input.wallet.getEthereumProvider();
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.wallet.address,
        to: input.to,
        data: input.data,
        ...(typeof input.value === "bigint" && input.value > 0n
          ? { value: bigintToHex(input.value) }
          : {}),
      },
    ],
  });

  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("Wallet provider did not return a transaction hash");
  }

  return hash as `0x${string}`;
}

function getAcrossChains() {
  const resolveChain = (chainId: number) => {
    if (chainId === mainnet.id) return mainnet;
    if (chainId === base.id) return base;
    if (chainId === sepolia.id) return sepolia;
    if (chainId === baseSepolia.id) return baseSepolia;
    return undefined;
  };

  const ethereum = resolveChain(runtimeConfig.chains.ethereum.chainId);
  const baseChain = resolveChain(runtimeConfig.chains.base.chainId);
  if (!ethereum || !baseChain) {
    throw new Error("Across client chain config is invalid");
  }
  return [ethereum, baseChain];
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

  const destinationToken = runtimeConfig.bridge.supportedAssets.find((asset) => {
    if (asset.chain !== input.destinationChain) {
      return false;
    }
    return asset.symbol === sourceToken.symbol;
  });
  const destinationTokenAddress =
    destinationToken && destinationToken.address !== "native"
      ? destinationToken.address.toLowerCase()
      : undefined;

  const matchedRoute = availableRoutes.find((route: any) => {
    if (sourceToken.address === "native") {
      return route.isNative === true;
    }
    return (
      route.inputToken.toLowerCase() === sourceToken.address.toLowerCase() &&
      destinationTokenAddress !== undefined &&
      route.outputToken.toLowerCase() === destinationTokenAddress
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
  const sourceChain = sourcePublicClient.chain ?? walletClient.chain;
  if (!sourceChain) {
    throw new Error("Unable to resolve source chain for bridge transaction");
  }

  let depositId: string | undefined;
  let originTxHash: `0x${string}` | undefined;

  try {
    await client.executeQuote({
      walletClient,
      deposit: quote.deposit,
      forceOriginChain: true,
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
    const rpcFailureMessage = normalizeRpcFailureMessage(message, input.sourceChain);
    const shouldFallback =
      message.includes("toLowerCase is not a function") ||
      message.includes('contract function "deposit"') ||
      message.includes("does not match 'originChainId'");
    if (!shouldFallback) {
      if (rpcFailureMessage) {
        throw new Error(rpcFailureMessage);
      }
      throw error;
    }

    const deposit = quote.deposit;
    if (!walletClient.account) {
      throw new Error("Privy wallet account is unavailable");
    }

    try {
      if (!deposit.isNative) {
        const allowance = await sourcePublicClient.readContract({
          address: deposit.inputToken,
          abi: APPROVE_ABI,
          functionName: "allowance",
          args: [walletClient.account.address, deposit.spokePoolAddress],
        });
        if (allowance < deposit.inputAmount) {
          const approveData = encodeFunctionData({
            abi: APPROVE_ABI,
            functionName: "approve",
            args: [deposit.spokePoolAddress, deposit.inputAmount],
          });
          const approveHash = await sendTransactionViaProvider({
            wallet,
            to: deposit.inputToken,
            data: approveData,
          });
          await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      const depositData = encodeFunctionData({
        abi: DEPOSIT_ABI,
        functionName: "deposit",
        args: [
          addressToBytes32(walletClient.account.address),
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
      originTxHash = await sendTransactionViaProvider({
        wallet,
        to: deposit.spokePoolAddress,
        data: bridgedData,
        value: deposit.isNative ? deposit.inputAmount : 0n,
      });

      const depositStatus = await (client as any).waitForDepositTx({
        originChainId: deposit.originChainId,
        transactionHash: originTxHash,
        publicClient: sourcePublicClient,
      });
      if (depositStatus?.depositId !== undefined) {
        depositId = String(depositStatus.depositId);
      }
    } catch (manualFallbackError) {
      const manualMessage = getErrorMessage(manualFallbackError);
      const rpcFailureDuringFallback = normalizeRpcFailureMessage(
        manualMessage,
        input.sourceChain,
      );
      if (rpcFailureDuringFallback) {
        throw new Error(rpcFailureDuringFallback);
      }
      throw new Error(`Across bridge submission failed: ${manualMessage}`);
    }
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
