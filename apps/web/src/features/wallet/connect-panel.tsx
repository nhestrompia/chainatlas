import { env } from "@/lib/config/env";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { usePrivySession } from "./use-privy-session";

function shortenAddress(address?: string) {
  if (!address) {
    return "Not connected";
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function ConnectPanel({ compact = false }: { compact?: boolean }) {
  const { connectOrCreateWallet, linkWallet } = usePrivy();
  const { address, authenticated, walletConnected, disconnect, ready } =
    usePrivySession();
  const setWallet = useAppStore((state) => state.setWallet);

  useEffect(() => {
    setWallet(address);
  }, [address, setWallet]);

  return (
    <section
      className={cn(
        "rounded-3xl border border-cyan-100/20 bg-[#101d25]/92 p-6 shadow-xl",
        compact ? "w-full max-w-md" : "w-full max-w-xl",
      )}
    >
      <p className="text-xs font-medium uppercase text-cyan-100/70">
        Wallet Gateway
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-balance">
        ChainAtlas Islands
      </h1>
      <p className="mt-2 text-sm text-cyan-100/75 text-pretty">
        Connect an Ethereum wallet to walk the Ethereum and Base islands, cross
        the bridge, and trigger live actions directly from districts.
      </p>

      <div className="mt-5 rounded-2xl border border-cyan-100/20 bg-cyan-50/8 p-4">
        <p className="text-xs uppercase text-cyan-100/70">Status</p>
        <p className="mt-2 text-lg font-medium text-cyan-50">
          {walletConnected
            ? shortenAddress(address)
            : authenticated
              ? "Signed in, wallet required"
              : "Not connected"}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-cyan-100/18 bg-cyan-50/8 p-3">
          <p className="text-xs uppercase text-cyan-100/70">Ethereum</p>
          <p className="mt-1 text-sm text-cyan-50">
            Swap hall and bridge origin
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-100/18 bg-cyan-50/8 p-3">
          <p className="text-xs uppercase text-cyan-100/70">Base</p>
          <p className="mt-1 text-sm text-cyan-50">
            Bridge destination and district portal
          </p>
        </div>
      </div>

      {compact ? (
        <div className="mt-4 rounded-2xl border border-cyan-100/20 bg-cyan-50/8 p-4">
          <p className="font-semibold text-cyan-50">WASD to move</p>
          <p className="mt-1 text-sm text-cyan-100/75 text-pretty">
            Walk into swap, bridge, or send zones to open prompts. Cross the
            bridge to switch chains.
          </p>
        </div>
      ) : null}

      {!env.privyAppId || !env.privyClientId ? (
        <p className="mt-5 rounded-2xl border border-amber-300/35 bg-amber-200/15 px-4 py-3 text-sm text-amber-100 text-pretty">
          Add `VITE_PRIVY_APP_ID` and `VITE_PRIVY_CLIENT_ID` to enable wallet
          login.
        </p>
      ) : null}

      <div className="mt-5 grid w-full items-center gap-3">
        {walletConnected ? (
          <button
            className="rounded-2xl border border-cyan-100/20 bg-cyan-50/15 px-4 py-3 font-medium text-cyan-50 hover:border-cyan-100/35 hover:bg-cyan-50/20"
            onClick={() => disconnect()}
            type="button"
          >
            Disconnect
          </button>
        ) : (
          <button
            className="rounded-2xl border border-cyan-100/20 bg-cyan-50/10 px-4 py-3 text-left font-medium hover:border-cyan-100/35 hover:bg-cyan-50/15"
            disabled={!ready || !env.privyAppId || !env.privyClientId}
            onClick={() => {
              if (authenticated) {
                linkWallet();
                return;
              }
              connectOrCreateWallet();
            }}
            type="button"
          >
            <span className="block text-lg justify-center text-center text-cyan-100/75">
              {authenticated ? "Link wallet" : "Connect wallet"}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
