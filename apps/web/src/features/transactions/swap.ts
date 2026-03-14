import { parseUnits } from "viem";
import { writeContract } from "viem/actions";
import type { ProtocolRegistryEntry, TransactionIntent } from "@cryptoworld/shared";
import {
  createChainPublicClient,
  createPrivyWalletClient,
  type ConnectedPrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { resolveSwapRoute } from "@/lib/protocol-registry";

const SWAP_ROUTER_ABI = [
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
  const value =
    route.supportsNativeIn && (input.assetAddress === "native" || !input.assetAddress) ? amountIn : 0n;

  const request = await publicClient.simulateContract({
    account: walletClient.account,
    address: route.routerAddress as `0x${string}`,
    abi: SWAP_ROUTER_ABI,
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
