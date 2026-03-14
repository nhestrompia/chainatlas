import { encodeFunctionData, getAddress, parseAbi, parseUnits } from "viem";
import type { ProtocolRegistryEntry, TransactionIntent } from "@chainatlas/shared";
import {
  createChainPublicClient,
  createPrivyWalletClient,
  type ConnectedPrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { resolveSwapRoute } from "@/lib/protocol-registry";

const UNISWAP_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const AERODROME_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const ERC20_ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

function toRpcHexQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function isMalformedErrorPayload(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.toLowerCase();
  return (
    (message.includes("err.details") && message.includes("tolowercase is not a function")) ||
    (message.includes("details is not a function") && message.includes("tolowercase"))
  );
}

async function trySimulate<T>(simulation: Promise<T>) {
  try {
    await simulation;
  } catch (error) {
    if (!isMalformedErrorPayload(error)) {
      throw error;
    }
  }
}

async function sendRawWalletTransaction(input: {
  wallet: ConnectedPrivyWallet;
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}) {
  const provider = await input.wallet.getEthereumProvider();
  const tx: Record<string, string> = {
    from: input.from,
    to: input.to,
    data: input.data,
  };
  if (typeof input.value === "bigint" && input.value > 0n) {
    tx.value = toRpcHexQuantity(input.value);
  }

  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  });

  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("Wallet returned an invalid transaction hash.");
  }

  return hash as `0x${string}`;
}

async function ensureTokenAllowance(input: {
  wallet: ConnectedPrivyWallet;
  tokenAddress: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  publicClient: ReturnType<typeof createChainPublicClient>;
  walletClient: Awaited<ReturnType<typeof createPrivyWalletClient>>;
}) {
  const account = input.walletClient.account;
  if (!account) {
    throw new Error("Privy wallet account is unavailable");
  }

  const allowance = await input.publicClient.readContract({
    address: input.tokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [input.owner, input.spender],
  });
  if (allowance >= input.amount) {
    return;
  }

  const approvalArgs = [input.spender, input.amount] as const;
  await trySimulate(
    input.publicClient.simulateContract({
      account,
      address: input.tokenAddress,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "approve",
      args: approvalArgs,
    }),
  );
  const approvalData = encodeFunctionData({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "approve",
    args: approvalArgs,
  });
  const approvalHash = await sendRawWalletTransaction({
    wallet: input.wallet,
    from: account.address,
    to: input.tokenAddress,
    data: approvalData,
  });
  await input.publicClient.waitForTransactionReceipt({ hash: approvalHash });
}

export async function executeSwap(
  input: TransactionIntent & {
    wallet: ConnectedPrivyWallet;
    registry: ProtocolRegistryEntry[];
  },
) {
  if (!input.routeId) {
    throw new Error("A swap route is required");
  }

  const route = resolveSwapRoute(input.registry, input.routeId);
  if (route.chain !== input.chain) {
    throw new Error("Swap route chain does not match selected chain");
  }

  const publicClient = createChainPublicClient(input.chain);
  const walletClient = await createPrivyWalletClient(input.wallet, input.chain);
  const account = walletClient.account;
  if (!account) {
    throw new Error("Privy wallet account is unavailable");
  }
  const amountIn = parseUnits(input.amount, route.inputTokenDecimals);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
  const tokenInAddress = getAddress(route.tokenIn as `0x${string}`);
  const tokenOutAddress = getAddress(route.tokenOut as `0x${string}`);
  const routerAddress = getAddress(route.routerAddress as `0x${string}`);
  const isNativeInput =
    route.supportsNativeIn && (input.assetAddress === "native" || !input.assetAddress);
  const value = isNativeInput ? amountIn : 0n;

  if (!isNativeInput) {
    await ensureTokenAllowance({
      wallet: input.wallet,
      tokenAddress: tokenInAddress,
      owner: account.address,
      spender: routerAddress,
      amount: amountIn,
      publicClient,
      walletClient,
    });
  }

  if (route.dex === "aerodrome") {
    if (!route.aerodromeFactory) {
      throw new Error("Aerodrome swap route is missing a factory address");
    }
    const path = [
      {
        from: tokenInAddress,
        to: tokenOutAddress,
        stable: Boolean(route.aerodromeStable),
        factory: getAddress(route.aerodromeFactory as `0x${string}`),
      },
    ] as const;

    if (isNativeInput) {
      const nativeSwapArgs = [0n, path, account.address, deadline] as const;
      await trySimulate(
        publicClient.simulateContract({
          account,
          address: routerAddress,
          abi: AERODROME_ROUTER_ABI,
          functionName: "swapExactETHForTokens",
          args: nativeSwapArgs,
          value,
        }),
      );
      const data = encodeFunctionData({
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactETHForTokens",
        args: nativeSwapArgs,
      });
      return await sendRawWalletTransaction({
        wallet: input.wallet,
        from: account.address,
        to: routerAddress,
        data,
        value,
      });
    }

    const tokenSwapArgs = [amountIn, 0n, path, account.address, deadline] as const;
    await trySimulate(
      publicClient.simulateContract({
        account,
        address: routerAddress,
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: tokenSwapArgs,
      }),
    );
    const data = encodeFunctionData({
      abi: AERODROME_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: tokenSwapArgs,
    });
    return await sendRawWalletTransaction({
      wallet: input.wallet,
      from: account.address,
      to: routerAddress,
      data,
    });
  }

  if (typeof route.feeTier !== "number") {
    throw new Error("Uniswap V3 route is missing a fee tier");
  }

  const exactInputSingleArgs = [
    {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: route.feeTier,
      recipient: account.address,
      deadline,
      amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    },
  ] as const;

  await trySimulate(
    publicClient.simulateContract({
      account,
      address: routerAddress,
      abi: UNISWAP_SWAP_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: exactInputSingleArgs,
      value,
    }),
  );
  const data = encodeFunctionData({
    abi: UNISWAP_SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: exactInputSingleArgs,
  });
  return await sendRawWalletTransaction({
    wallet: input.wallet,
    from: account.address,
    to: routerAddress,
    data,
    value,
  });
}
