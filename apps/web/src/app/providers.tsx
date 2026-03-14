import { env } from "@/lib/config/env";
import { runtimeProfile } from "@/lib/config/runtime";
import { wagmiConfig } from "@/lib/wagmi/config";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

const queryClient = new QueryClient();
const privySupportedChains =
  runtimeProfile === "testnet" ? [sepolia, baseSepolia] : [mainnet, base];
const privyDefaultChain = privySupportedChains[0];

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId}
      config={{
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: privyDefaultChain,
        supportedChains: privySupportedChains,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
          <Toaster position="top-center" richColors theme="dark" />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
