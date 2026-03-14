import { parseAbi, parseUnits } from "viem";
import { writeContract } from "viem/actions";
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

async function ensureTokenAllowance(input: {
  tokenAddress: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  publicClient: ReturnType<typeof createChainPublicClient>;
  walletClient: Awaited<ReturnType<typeof createPrivyWalletClient>>;
}) {
  const allowance = await input.publicClient.readContract({
    address: input.tokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [input.owner, input.spender],
  });
  if (allowance >= input.amount) {
    return;
  }

  const approval = await input.publicClient.simulateContract({
    account: input.walletClient.account,
    address: input.tokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "approve",
    args: [input.spender, input.amount],
  });
  const approvalHash = await writeContract(input.walletClient, approval.request);
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
  if (!walletClient.account) {
    throw new Error("Privy wallet account is unavailable");
  }
  const amountIn = parseUnits(input.amount, route.inputTokenDecimals);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
  const isNativeInput =
    route.supportsNativeIn && (input.assetAddress === "native" || !input.assetAddress);
  const value = isNativeInput ? amountIn : 0n;

  if (!isNativeInput) {
    await ensureTokenAllowance({
      tokenAddress: route.tokenIn as `0x${string}`,
      owner: walletClient.account.address,
      spender: route.routerAddress as `0x${string}`,
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
        from: route.tokenIn as `0x${string}`,
        to: route.tokenOut as `0x${string}`,
        stable: Boolean(route.aerodromeStable),
        factory: route.aerodromeFactory as `0x${string}`,
      },
    ] as const;

    if (isNativeInput) {
      const request = await publicClient.simulateContract({
        account: walletClient.account,
        address: route.routerAddress as `0x${string}`,
        abi: AERODROME_ROUTER_ABI,
        functionName: "swapExactETHForTokens",
        args: [0n, path, walletClient.account.address, deadline],
        value,
      });
      return writeContract(walletClient, request.request);
    }

    const request = await publicClient.simulateContract({
      account: walletClient.account,
      address: route.routerAddress as `0x${string}`,
      abi: AERODROME_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, 0n, path, walletClient.account.address, deadline],
    });
    return writeContract(walletClient, request.request);
  }

  if (typeof route.feeTier !== "number") {
    throw new Error("Uniswap V3 route is missing a fee tier");
  }

  const request = await publicClient.simulateContract({
    account: walletClient.account,
    address: route.routerAddress as `0x${string}`,
    abi: UNISWAP_SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: route.tokenIn as `0x${string}`,
        tokenOut: route.tokenOut as `0x${string}`,
        fee: route.feeTier,
        recipient: walletClient.account.address,
        deadline,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
    value,
  });

  return writeContract(walletClient, request.request);
}
