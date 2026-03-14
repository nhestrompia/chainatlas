import { createConfig } from "@privy-io/wagmi";
import { fallback, http } from "wagmi";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import { env } from "@/lib/config/env";

function normalizeUrls(urls: string[]) {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

function createTransport(urls: string[]) {
  const candidates = normalizeUrls(urls);
  if (candidates.length <= 1) {
    return http(candidates[0]);
  }
  return fallback(candidates.map((url) => http(url)));
}

const ethereumMainnetFallbackUrls = [
  env.ethereumRpcUrl,
  "https://ethereum-rpc.publicnode.com",
  mainnet.rpcUrls.default.http[0],
];
const ethereumSepoliaFallbackUrls = [
  env.sepoliaRpcUrl,
  env.ethereumRpcUrl,
  "https://ethereum-sepolia-rpc.publicnode.com",
  sepolia.rpcUrls.default.http[0],
];
const baseMainnetFallbackUrls = [
  env.baseRpcUrl,
  "https://base-rpc.publicnode.com",
  base.rpcUrls.default.http[0],
];
const baseSepoliaFallbackUrls = [
  env.baseSepoliaRpcUrl,
  env.baseRpcUrl,
  "https://base-sepolia-rpc.publicnode.com",
  baseSepolia.rpcUrls.default.http[0],
];

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, base, baseSepolia],
  transports: {
    [mainnet.id]: createTransport(ethereumMainnetFallbackUrls),
    [sepolia.id]: createTransport(ethereumSepoliaFallbackUrls),
    [base.id]: createTransport(baseMainnetFallbackUrls),
    [baseSepolia.id]: createTransport(baseSepoliaFallbackUrls),
  },
});
