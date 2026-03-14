export const env = {
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID ?? "",
  privyClientId: import.meta.env.VITE_PRIVY_CLIENT_ID ?? "",
  profile: import.meta.env.VITE_CRYPTO_WORLD_PROFILE ?? "testnet",
  acrossIntegratorId: import.meta.env.VITE_ACROSS_INTEGRATOR_ID ?? "0x0000",
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000",
  partyHost: import.meta.env.VITE_PARTYKIT_HOST ?? "localhost:1999",
  ethereumRpcUrl: import.meta.env.VITE_ETHEREUM_RPC_URL ?? "",
  baseRpcUrl: import.meta.env.VITE_BASE_RPC_URL ?? "",
  sepoliaRpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL ?? "",
  baseSepoliaRpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? "",
};
