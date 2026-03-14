import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import { env } from "@/lib/config/env";

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, base, baseSepolia],
  transports: {
    [mainnet.id]: http(env.ethereumRpcUrl || mainnet.rpcUrls.default.http[0]),
    [sepolia.id]: http(env.sepoliaRpcUrl || env.ethereumRpcUrl || sepolia.rpcUrls.default.http[0]),
    [base.id]: http(env.baseRpcUrl || base.rpcUrls.default.http[0]),
    [baseSepolia.id]: http(env.baseSepoliaRpcUrl || env.baseRpcUrl || baseSepolia.rpcUrls.default.http[0]),
  },
});
