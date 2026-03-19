import type { RuntimeAddressOverrides } from "@chainatlas/shared";

function optionalEnvAddress(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const env = {
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID ?? "",
  privyClientId: import.meta.env.VITE_PRIVY_CLIENT_ID ?? "",
  profile: import.meta.env.VITE_CRYPTO_WORLD_PROFILE ?? "mainnet",
  acrossIntegratorId: import.meta.env.VITE_ACROSS_INTEGRATOR_ID ?? "0x0000",
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000",
  partyHost: import.meta.env.VITE_PARTYKIT_HOST ?? "localhost:1999",
  ethereumRpcUrl: import.meta.env.VITE_ETHEREUM_RPC_URL ?? "",
  baseRpcUrl: import.meta.env.VITE_BASE_RPC_URL ?? "",
  polygonRpcUrl: import.meta.env.VITE_POLYGON_RPC_URL ?? "",
  sepoliaRpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL ?? "",
  baseSepoliaRpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? "",
  polygonAmoyRpcUrl: import.meta.env.VITE_POLYGON_AMOY_RPC_URL ?? "",
  protocolAddressOverrides: {
    uniswapRouterEthereum: optionalEnvAddress(import.meta.env.VITE_UNISWAP_ROUTER_ETHEREUM),
    uniswapRouterBase: optionalEnvAddress(import.meta.env.VITE_UNISWAP_ROUTER_BASE),
    aerodromeRouterBase: optionalEnvAddress(import.meta.env.VITE_AERODROME_ROUTER_BASE),
    aerodromeFactoryBase: optionalEnvAddress(import.meta.env.VITE_AERODROME_FACTORY_BASE),
    acrossSpokePoolEthereum: optionalEnvAddress(import.meta.env.VITE_ACROSS_SPOKE_POOL_ETHEREUM),
    acrossSpokePoolBase: optionalEnvAddress(import.meta.env.VITE_ACROSS_SPOKE_POOL_BASE),
    wrappedNativeEthereum: optionalEnvAddress(import.meta.env.VITE_WRAPPED_NATIVE_ETHEREUM),
    wrappedNativeBase: optionalEnvAddress(import.meta.env.VITE_WRAPPED_NATIVE_BASE),
    usdcEthereum: optionalEnvAddress(import.meta.env.VITE_USDC_ETHEREUM),
    usdcBase: optionalEnvAddress(import.meta.env.VITE_USDC_BASE),
    usdtEthereum: optionalEnvAddress(import.meta.env.VITE_USDT_ETHEREUM),
    usdtBase: optionalEnvAddress(import.meta.env.VITE_USDT_BASE),
  } satisfies RuntimeAddressOverrides,
};
