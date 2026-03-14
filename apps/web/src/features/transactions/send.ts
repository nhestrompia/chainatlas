import { encodeFunctionData, parseEther, parseUnits } from "viem";
import type { TransactionIntent } from "@cryptoworld/shared";
import { type ConnectedPrivyWallet } from "@/features/wallet/use-privy-wallet";

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type EthereumProviderLike = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

const WALLET_REQUEST_TIMEOUT_MS = 45_000;

function bigintToHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function sendViaProvider(input: {
  wallet: ConnectedPrivyWallet;
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
}) {
  const provider = (await input.wallet.getEthereumProvider()) as EthereumProviderLike;
  const hash = await withTimeout(
    provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: input.wallet.address,
          to: input.to,
          ...(typeof input.value === "bigint" && input.value > 0n
            ? { value: bigintToHex(input.value) }
            : {}),
          ...(input.data ? { data: input.data } : {}),
        },
      ],
    }),
    WALLET_REQUEST_TIMEOUT_MS,
    "Wallet request timed out while sending transaction. Open wallet and retry.",
  );

  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("Wallet provider did not return a transaction hash");
  }

  return hash as `0x${string}`;
}

export async function sendNative(input: TransactionIntent & { wallet: ConnectedPrivyWallet }) {
  if (!input.targetAddress) {
    throw new Error("A target address is required");
  }

  const value = parseEther(input.amount);
  return await sendViaProvider({
    wallet: input.wallet,
    to: input.targetAddress as `0x${string}`,
    value,
  });
}

export async function sendErc20(
  input: TransactionIntent & { wallet: ConnectedPrivyWallet; assetDecimals?: number },
) {
  if (!input.targetAddress || !input.assetAddress || input.assetAddress === "native") {
    throw new Error("ERC-20 send requires token and recipient");
  }

  const decimals =
    typeof input.assetDecimals === "number" && Number.isInteger(input.assetDecimals)
      ? input.assetDecimals
      : 18;
  const transferValue = parseUnits(input.amount, decimals);
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [input.targetAddress as `0x${string}`, transferValue],
  });
  return await sendViaProvider({
    wallet: input.wallet,
    to: input.assetAddress as `0x${string}`,
    data,
  });
}
