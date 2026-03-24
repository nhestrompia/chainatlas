import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  type FormEvent,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SHOUT_COOLDOWN_MS, SHOUT_MAX_CHARS, SHOUT_TTL_MS } from "./constants";
import { shortAddress } from "./helpers";

const LazyInventoryPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.InventoryPanel,
  })),
);
const LazySwapPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.SwapPanel,
  })),
);
const LazySwapSelectPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.SwapSelectPanel,
  })),
);
const LazyBridgePanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.BridgePanel,
  })),
);
const LazyBridgeSelectPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.BridgeSelectPanel,
  })),
);
const LazySendPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.SendPanel,
  })),
);
const LazySendSelectPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.SendSelectPanel,
  })),
);
const LazyJobsPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.JobsPanel,
  })),
);
const LazyChatPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.ChatPanel,
  })),
);
const LazyPlayerPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.PlayerPanel,
  })),
);
const LazyMerchantPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.MerchantPanel,
  })),
);
const LazyPredictionPanel = lazy(() =>
  import("@/features/overlays/action-panels").then((module) => ({
    default: module.PredictionPanel,
  })),
);

export function WorldHud() {
  const { address, authenticated, disconnect } = usePrivyWallet();
  const session = useAppStore((state) => state.session);
  const overlays = useAppStore((state) => state.overlays);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const setLocalShout = useAppStore((state) => state.setLocalShout);
  const localPresence = useAppStore((state) => state.presence.local);
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const nearbyMerchantSeller = useAppStore(
    (state) => state.overlays.nearbyMerchantSeller,
  );
  const nearbyMerchantShop = useAppStore((state) => {
    const seller = state.overlays.nearbyMerchantSeller?.toLowerCase();
    if (!seller) {
      return undefined;
    }
    return state.merchants.shops[seller];
  });
  const nearbyTargetLabel = useAppStore((state) => {
    const target = state.overlays.nearbyTarget?.toLowerCase();
    if (!target) {
      return undefined;
    }
    const snapshot = Object.values(state.presence.remote).find(
      (presence) => presence.address.toLowerCase() === target,
    );
    return snapshot?.displayName;
  });
  const nearbyPlayers = useAppStore((state) => {
    const localAddress =
      typeof state.presence.local?.address === "string"
        ? state.presence.local.address.toLowerCase()
        : undefined;
    return Object.values(state.presence.remote).filter((snapshot) => {
      const remoteAddress =
        typeof snapshot.address === "string"
          ? snapshot.address.toLowerCase()
          : undefined;
      if (!remoteAddress) {
        return false;
      }
      return localAddress ? remoteAddress !== localAddress : true;
    }).length;
  });

  const panel = useMemo(() => {
    if (overlays.activeOverlay === "inventory") return <LazyInventoryPanel />;
    if (overlays.activeOverlay === "swap") {
      return overlays.swapStep === "details" ? (
        <LazySwapPanel />
      ) : (
        <LazySwapSelectPanel />
      );
    }
    if (overlays.activeOverlay === "bridge") {
      return overlays.bridgeStep === "details" ? (
        <LazyBridgePanel />
      ) : (
        <LazyBridgeSelectPanel />
      );
    }
    if (overlays.activeOverlay === "send") {
      return overlays.sendStep === "details" ? (
        <LazySendPanel />
      ) : (
        <LazySendSelectPanel />
      );
    }
    if (overlays.activeOverlay === "jobs") return <LazyJobsPanel />;
    if (overlays.activeOverlay === "chat") return <LazyChatPanel />;
    if (overlays.activeOverlay === "player") return <LazyPlayerPanel />;
    if (overlays.activeOverlay === "merchant") return <LazyMerchantPanel />;
    if (overlays.activeOverlay === "prediction") return <LazyPredictionPanel />;
    return null;
  }, [
    overlays.activeOverlay,
    overlays.bridgeStep,
    overlays.sendStep,
    overlays.swapStep,
  ]);
  const immersiveActionPanel =
    overlays.activeOverlay === "swap" ||
    overlays.activeOverlay === "send" ||
    overlays.activeOverlay === "bridge" ||
    overlays.activeOverlay === "prediction";
  const panelWidthClass = useMemo(() => {
    if (overlays.activeOverlay === "merchant") {
      return "max-w-[480px]";
    }
    if (!immersiveActionPanel) {
      return "max-w-[540px]";
    }
    if (overlays.activeOverlay === "swap") {
      return overlays.swapStep === "details"
        ? "max-w-[440px]"
        : "max-w-[500px]";
    }
    if (overlays.activeOverlay === "send") {
      return overlays.sendStep === "details"
        ? "max-w-[440px]"
        : "max-w-[500px]";
    }
    if (overlays.activeOverlay === "bridge") {
      return overlays.bridgeStep === "details"
        ? "max-w-[440px]"
        : "max-w-[500px]";
    }
    if (overlays.activeOverlay === "prediction") {
      return "max-w-[460px]";
    }
    return "max-w-[540px]";
  }, [
    immersiveActionPanel,
    overlays.activeOverlay,
    overlays.bridgeStep,
    overlays.sendStep,
    overlays.swapStep,
  ]);
  const [shoutDraft, setShoutDraft] = useState("");
  const [shoutCooldownUntil, setShoutCooldownUntil] = useState(0);
  const [cooldownTick, setCooldownTick] = useState(0);
  const cooldownRemainingMs = Math.max(0, shoutCooldownUntil - cooldownTick);
  const canShout =
    Boolean(localPresence) &&
    cooldownRemainingMs <= 0 &&
    shoutDraft.trim().length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverlay(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOverlay]);

  useEffect(() => {
    if (shoutCooldownUntil <= Date.now()) {
      setCooldownTick(Date.now());
      return;
    }
    const intervalId = window.setInterval(() => {
      setCooldownTick(Date.now());
    }, 150);
    return () => window.clearInterval(intervalId);
  }, [shoutCooldownUntil]);

  const handleShoutSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!localPresence || cooldownRemainingMs > 0) {
      return;
    }
    const text = shoutDraft
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SHOUT_MAX_CHARS);
    if (!text) {
      return;
    }
    const now = Date.now();
    setLocalShout(text, now + SHOUT_TTL_MS);
    setShoutCooldownUntil(now + SHOUT_COOLDOWN_MS);
    setCooldownTick(now);
    setShoutDraft("");
  };

  return (
    <>
      {!immersiveActionPanel ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="rounded-full border border-cyan-100/20 bg-[#08151d]/85 px-3 py-1.5 text-sm text-cyan-50 shadow-xl backdrop-blur-xl">
              <span className="text-cyan-100/60">Island </span>
              <span className="font-semibold">
                {session.activeChain === "ethereum"
                  ? "Ethereum"
                  : session.activeChain === "polygon"
                    ? "Polygon"
                    : "Base"}
              </span>
            </div>
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded-full border border-cyan-100/20 bg-[#08151d]/85 px-3 py-1.5 text-cyan-50 shadow-xl backdrop-blur-xl"
                    type="button"
                  >
                    <span>
                      Wallet{" "}
                      {address
                        ? `${address.slice(0, 6)}...${address.slice(-4)}`
                        : "Preview"}
                    </span>
                    <span aria-hidden className="text-[10px] text-cyan-100/70">
                      ▾
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!authenticated}
                    onSelect={() => {
                      if (authenticated) disconnect();
                    }}
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {address ? (
                <button
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-amber-50 shadow-xl backdrop-blur-xl transition-colors",
                    overlays.activeOverlay === "merchant" &&
                      overlays.nearbyMerchantSeller?.toLowerCase() ===
                        address.toLowerCase()
                      ? "border-amber-200/65 bg-amber-300/25"
                      : "border-amber-200/40 bg-[#2b1e12]/88 hover:border-amber-200/60 hover:bg-[#3a2818]",
                  )}
                  onClick={() => setOverlay("merchant", address)}
                  type="button"
                >
                  My Merchant
                </button>
              ) : null}
              {/* <div className="rounded-full border border-cyan-100/20 bg-[#08151d]/85 px-3 py-1.5 text-cyan-50 shadow-xl tabular-nums backdrop-blur-xl">
                Players {nearbyPlayers}
              </div> */}
              {nearbyTarget ? (
                <button
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-cyan-50 shadow-xl backdrop-blur-xl transition-colors",
                    overlays.activeOverlay === "player"
                      ? "border-emerald-200/50 bg-emerald-300/20"
                      : "border-emerald-200/35 bg-[#0f2938]/85 hover:border-emerald-200/55 hover:bg-[#18384b]",
                  )}
                  onClick={() => setOverlay("player", nearbyTarget)}
                  type="button"
                >
                  Interact{" "}
                  <span className="text-cyan-100/75">
                    {nearbyTargetLabel
                      ? `· ${nearbyTargetLabel}`
                      : `· ${shortAddress(nearbyTarget)}`}
                  </span>
                </button>
              ) : null}
              {nearbyMerchantSeller && nearbyMerchantShop ? (
                <button
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-amber-50 shadow-xl backdrop-blur-xl transition-colors",
                    overlays.activeOverlay === "merchant"
                      ? "border-amber-200/65 bg-amber-300/25"
                      : "border-amber-200/40 bg-[#2b1e12]/88 hover:border-amber-200/60 hover:bg-[#3a2818]",
                  )}
                  onClick={() => setOverlay("merchant", nearbyMerchantSeller)}
                  type="button"
                >
                  Merchant
                  <span className="ml-1 text-amber-100/80">
                    · {nearbyMerchantShop.listings.length} items
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!immersiveActionPanel ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-2xl pr-16">
            <form
              className="pointer-events-auto flex w-full items-center gap-2 rounded-full border border-cyan-100/20 bg-[#08151d]/88 px-2 py-1.5 shadow-xl backdrop-blur-xl"
              onSubmit={handleShoutSubmit}
            >
              <input
                className="w-full bg-transparent px-2 text-sm text-cyan-50 outline-none placeholder:text-cyan-100/55"
                disabled={!localPresence}
                maxLength={SHOUT_MAX_CHARS}
                onChange={(event) => setShoutDraft(event.target.value)}
                placeholder="Shout to nearby players..."
                type="text"
                value={shoutDraft}
              />
              <span className="text-[11px] text-cyan-100/65 tabular-nums">
                {shoutDraft.length}/{SHOUT_MAX_CHARS}
              </span>
              <button
                className="rounded-full border border-cyan-100/30 bg-cyan-50/12 px-3 py-1 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-cyan-50/18 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canShout}
                type="submit"
              >
                Shout
              </button>
              {cooldownRemainingMs > 0 ? (
                <span className="min-w-[44px] text-right text-[11px] text-cyan-100/65 tabular-nums">
                  {(cooldownRemainingMs / 1000).toFixed(1)}s
                </span>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}

      {!immersiveActionPanel ? (
        <div className="pointer-events-none absolute bottom-0 right-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Open inventory"
                  className={cn(
                    "pointer-events-auto flex size-11 items-center justify-center rounded-full border shadow-xl backdrop-blur-xl transition-colors",
                    overlays.activeOverlay === "inventory"
                      ? "border-cyan-100/50 bg-cyan-50/20 text-cyan-50"
                      : "border-cyan-100/20 bg-[#08151d]/90 text-cyan-100/80 hover:border-cyan-100/35 hover:bg-cyan-50/15 hover:text-cyan-50",
                  )}
                  onClick={() =>
                    setOverlay(
                      overlays.activeOverlay === "inventory"
                        ? undefined
                        : "inventory",
                    )
                  }
                  type="button"
                >
                  <svg
                    aria-hidden
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <rect height="14" rx="2" width="16" x="4" y="6" />
                    <path d="M4 10h16" />
                    <path d="M9 14h.01" />
                    <path d="M12 14h.01" />
                    <path d="M15 14h.01" />
                  </svg>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Inventory</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}

      {panel ? (
        <div
          className={cn(
            "absolute inset-x-0 z-30 flex justify-center px-3",
            immersiveActionPanel
              ? "pointer-events-none bottom-0 items-end pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              : "pointer-events-auto inset-y-0 items-center bg-[#040c12]/52 py-[max(1rem,env(safe-area-inset-top))]",
          )}
          onClick={() => {
            if (!immersiveActionPanel) {
              setOverlay(undefined);
            }
          }}
        >
          <div
            className={cn(
              "pointer-events-auto relative w-full",
              panelWidthClass,
              overlays.activeOverlay === "prediction" &&
                "prediction-panel-enter",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              aria-label="Close action panel"
              className={cn(
                "absolute right-3 z-10 flex size-8 items-center justify-center rounded-lg border text-base font-semibold leading-none shadow-lg backdrop-blur-xl",
                overlays.activeOverlay === "merchant"
                  ? "border-[#746949] bg-[#1f2219]/95 text-[#dccaa0] hover:bg-[#2a2d23]"
                  : "border-cyan-100/30 bg-[#08151d]/95 text-cyan-50 hover:bg-[#0d1f2b]",
                immersiveActionPanel ? "top-2" : "top-3",
              )}
              onClick={() => setOverlay(undefined)}
              type="button"
            >
              ×
            </button>
            <Suspense
              fallback={
                <div className="rounded-2xl border border-cyan-100/20 bg-[#08151d]/92 p-4 text-sm text-cyan-100/80 shadow-2xl backdrop-blur-xl">
                  Loading panel...
                </div>
              }
            >
              {panel}
            </Suspense>
          </div>
        </div>
      ) : null}
    </>
  );
}
