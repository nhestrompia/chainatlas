import { AppProviders } from "@/app/providers";
import { ConnectPanel } from "@/features/wallet/connect-panel";
import { usePrivySession } from "@/features/wallet/use-privy-session";
import { Suspense, lazy } from "react";

const LazyWorldExperience = lazy(() =>
  import("@/routes/world-experience").then((module) => ({
    default: module.WorldExperience,
  })),
);

function WorldRouteInner() {
  const { walletConnected } = usePrivySession();

  if (!walletConnected) {
    return (
      <main className="relative h-dvh overflow-hidden bg-[#08161e]">
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/95 px-6">
          <div className="max-w-xl flex flex-col items-center">
            <ConnectPanel compact />
            <p className="mt-4 text-center text-sm text-cyan-100/70 text-pretty">
              Connect a wallet to enter synchronized multiplayer islands with
              live send, swap, and bridge flows.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="relative h-dvh overflow-hidden bg-[#08161e]" />
      }
    >
      <LazyWorldExperience />
    </Suspense>
  );
}

export function WorldRoute() {
  return (
    <AppProviders>
      <WorldRouteInner />
    </AppProviders>
  );
}
