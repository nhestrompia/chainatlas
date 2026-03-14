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
import { usePartyPresence } from "@/features/presence/use-party-presence";
import { ConnectPanel } from "@/features/wallet/connect-panel";
import {
  ensureWalletChain,
  fetchWalletPortfolio,
  getConnectedWalletChainState,
  resolveEnsName,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { fetchBridgeJobs, fetchPortfolio } from "@/lib/api/client";
import { runtimeConfig } from "@/lib/config/runtime";
import { deriveMinions } from "@/lib/minions";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  type AvatarId,
  type ChainSlug,
  type PortfolioAsset,
} from "@cryptoworld/shared";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  type Address,
} from "viem";
import { useBalance, useReadContracts } from "wagmi";
import char1Img1xUrl from "../../../char-img/optimized/char1-1x.jpg?url";
import char1Img2xUrl from "../../../char-img/optimized/char1-2x.jpg?url";
import char2Img1xUrl from "../../../char-img/optimized/char2-1x.jpg?url";
import char2Img2xUrl from "../../../char-img/optimized/char2-2x.jpg?url";
import char3Img1xUrl from "../../../char-img/optimized/char3-1x.jpg?url";
import char3Img2xUrl from "../../../char-img/optimized/char3-2x.jpg?url";
import char4Img1xUrl from "../../../char-img/optimized/char4-1x.jpg?url";
import char4Img2xUrl from "../../../char-img/optimized/char4-2x.jpg?url";

const LazyCryptoWorldScene = lazy(() =>
  import("@/scene/components/crypto-world-scene").then((module) => ({
    default: module.CryptoWorldScene,
  })),
);

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

const NATIVE_CHAIN_IDS: Record<ChainSlug, number> = {
  ethereum: runtimeConfig.chains.ethereum.chainId,
  base: runtimeConfig.chains.base.chainId,
};

const ROOM_BY_CHAIN: Record<ChainSlug, "ethereum:main" | "base:main"> = {
  ethereum: "ethereum:main",
  base: "base:main",
};

type SupportedErc20Token = {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;
};

const CHARACTER_OPTIONS: Array<{
  id: AvatarId;
  label: string;
  description: string;
  imageUrl: string;
  imageSrcSet: string;
}> = [
  {
    id: "navigator",
    label: "Navigator",
    description: "Steady all-round explorer.",
    imageUrl: char1Img1xUrl,
    imageSrcSet: `${char1Img1xUrl} 1x, ${char1Img2xUrl} 2x`,
  },
  {
    id: "warden",
    label: "Warden",
    description: "Solid and grounded silhouette.",
    imageUrl: char2Img1xUrl,
    imageSrcSet: `${char2Img1xUrl} 1x, ${char2Img2xUrl} 2x`,
  },
  {
    id: "sprinter",
    label: "Sprinter",
    description: "Light frame tuned for movement.",
    imageUrl: char3Img1xUrl,
    imageSrcSet: `${char3Img1xUrl} 1x, ${char3Img2xUrl} 2x`,
  },
  {
    id: "mystic",
    label: "Mystic",
    description: "Arcane style with distinct shape.",
    imageUrl: char4Img1xUrl,
    imageSrcSet: `${char4Img1xUrl} 1x, ${char4Img2xUrl} 2x`,
  },
];

function isAvatarId(value: string | null): value is AvatarId {
  return CHARACTER_OPTIONS.some((option) => option.id === value);
}

function shortenIdentity(value?: string) {
  if (!value) {
    return "Preview";
  }

  const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(value);
  if (!isWalletAddress) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function avatarStorageKey(address: string) {
  return `cryptoworld:selected-avatar:${address.toLowerCase()}`;
}

function mergePortfolioAssets(...collections: PortfolioAsset[][]) {
  const map = new Map<string, PortfolioAsset>();

  for (const assets of collections) {
    for (const asset of assets) {
      const key = `${asset.chain}:${asset.address}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, asset);
      }
    }
  }

  return [...map.values()];
}

function toAssetKey(chain: string | undefined, address: string | undefined) {
  if (!chain || !address) {
    return undefined;
  }
  return `${chain}:${address}`.toLowerCase();
}

function toPortfolioAssetFromNativeBalance(
  chain: ChainSlug,
  value: bigint | undefined,
  formatted: string | undefined,
): PortfolioAsset | undefined {
  if (!value || value <= 0n || !formatted) {
    return undefined;
  }

  return {
    chain,
    address: "native",
    symbol: "ETH",
    name: "Ether",
    balance: formatted,
    decimals: 18,
    usdValue: 0,
    verified: true,
  };
}

function getSupportedErc20Tokens(chain: ChainSlug): SupportedErc20Token[] {
  const tokens = new Map<string, SupportedErc20Token>();

  for (const entry of runtimeConfig.protocolRegistry) {
    for (const token of entry.supportedTokens) {
      if (
        token.chain !== chain ||
        token.address === "native" ||
        !isAddress(token.address)
      ) {
        continue;
      }

      const address = getAddress(token.address);
      const key = `${chain}:${address}`.toLowerCase();
      if (tokens.has(key)) {
        continue;
      }

      const decimals =
        typeof token.decimals === "number" && Number.isFinite(token.decimals)
          ? token.decimals
          : 18;

      tokens.set(key, {
        address,
        symbol: token.symbol,
        decimals,
        name: token.symbol === "USDC" ? "USD Coin" : token.symbol,
      });
    }
  }

  return [...tokens.values()];
}

function resolveReadContractBigInt(value: unknown) {
  if (typeof value === "bigint") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const resultRecord = value as { result?: unknown; status?: unknown };
  if (
    typeof resultRecord.status === "string" &&
    resultRecord.status !== "success"
  ) {
    return undefined;
  }

  return typeof resultRecord.result === "bigint"
    ? resultRecord.result
    : undefined;
}

function CharacterPreview({
  imageUrl,
  imageSrcSet,
  label,
}: {
  imageUrl: string;
  imageSrcSet: string;
  label: string;
}) {
  return (
    <div className="h-16 w-14 overflow-hidden rounded-xl border border-cyan-100/25 bg-black/30">
      <img
        alt={`${label} avatar`}
        className="h-full w-full object-cover"
        decoding="async"
        loading="lazy"
        sizes="56px"
        src={imageUrl}
        srcSet={imageSrcSet}
      />
    </div>
  );
}

function CharacterSelectOverlay({
  onSelect,
}: {
  onSelect(avatarId: AvatarId): void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/88 px-4">
      <div className="w-full max-w-3xl rounded-3xl border border-cyan-100/20 bg-[#101d25]/95 p-6 shadow-2xl">
        <p className="text-xs uppercase text-cyan-100/70">Choose Character</p>
        <h2 className="mt-2 text-2xl font-semibold text-cyan-50">
          Pick your avatar before entering
        </h2>
        <p className="mt-2 text-sm text-cyan-100/75">
          Your choice is saved per wallet and used for multiplayer presence.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {CHARACTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="flex items-center gap-4 rounded-2xl border border-cyan-100/20 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15"
              onClick={() => onSelect(option.id)}
              type="button"
            >
              <CharacterPreview
                imageUrl={option.imageUrl}
                imageSrcSet={option.imageSrcSet}
                label={option.label}
              />
              <div>
                <p className="font-semibold text-cyan-50">{option.label}</p>
                <p className="mt-1 text-xs text-cyan-100/75">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChainSelectionOverlay({
  chainId,
  error,
  pendingChain,
  onSelect,
}: {
  chainId?: number;
  error?: string;
  pendingChain?: ChainSlug;
  onSelect(chain: ChainSlug): void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/90 px-4">
      <div className="w-full max-w-xl rounded-3xl border border-cyan-100/20 bg-[#101d25]/95 p-6 shadow-2xl">
        <p className="text-xs uppercase text-cyan-100/70">Select Chain</p>
        <h2 className="mt-2 text-2xl font-semibold text-cyan-50">
          Choose a supported world chain
        </h2>
        <p className="mt-2 text-sm text-cyan-100/75">
          {typeof chainId === "number"
            ? `Your wallet is on unsupported chain ID ${chainId}.`
            : "We could not confirm your wallet network."}{" "}
          Switch to Ethereum or Base to enter.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-2xl border border-cyan-100/25 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(pendingChain)}
            onClick={() => onSelect("ethereum")}
            type="button"
          >
            <p className="font-semibold text-cyan-50">Ethereum Island</p>
            <p className="mt-1 text-xs text-cyan-100/75">
              {runtimeConfig.chains.ethereum.label}
            </p>
          </button>
          <button
            className="rounded-2xl border border-cyan-100/25 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(pendingChain)}
            onClick={() => onSelect("base")}
            type="button"
          >
            <p className="font-semibold text-cyan-50">Base Island</p>
            <p className="mt-1 text-xs text-cyan-100/75">
              {runtimeConfig.chains.base.label}
            </p>
          </button>
        </div>
        {pendingChain ? (
          <p className="mt-4 text-sm text-cyan-100/80">
            Switching wallet to{" "}
            {pendingChain === "ethereum"
              ? runtimeConfig.chains.ethereum.label
              : runtimeConfig.chains.base.label}
            ...
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200/35 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WorldHud() {
  const { address, authenticated, disconnect } = usePrivyWallet();
  const session = useAppStore((state) => state.session);
  const overlays = useAppStore((state) => state.overlays);
  const minions = useAppStore((state) => state.minions);
  const setOverlay = useAppStore((state) => state.setOverlay);
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
    if (overlays.activeOverlay === "bridge") return <LazyBridgePanel />;
    if (overlays.activeOverlay === "send") {
      return overlays.sendStep === "details" ? (
        <LazySendPanel />
      ) : (
        <LazySendSelectPanel />
      );
    }
    if (overlays.activeOverlay === "jobs") return <LazyJobsPanel />;
    return null;
  }, [overlays.activeOverlay, overlays.sendStep, overlays.swapStep]);
  const immersiveActionPanel =
    overlays.activeOverlay === "swap" || overlays.activeOverlay === "send";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverlay(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOverlay]);

  return (
    <>
      {!immersiveActionPanel ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="rounded-full border border-cyan-100/20 bg-[#08151d]/85 px-3 py-1.5 text-sm text-cyan-50 shadow-xl backdrop-blur-xl">
              <span className="text-cyan-100/60">Island </span>
              <span className="font-semibold">
                {session.activeChain === "ethereum" ? "Ethereum" : "Base"}
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
              <div className="rounded-full border border-cyan-100/20 bg-[#08151d]/85 px-3 py-1.5 text-cyan-50 shadow-xl tabular-nums backdrop-blur-xl">
                Players {nearbyPlayers}
              </div>
            </div>
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
              immersiveActionPanel
                ? overlays.activeOverlay === "swap"
                  ? overlays.swapStep === "details"
                    ? "max-w-[440px]"
                    : "max-w-[500px]"
                  : overlays.sendStep === "details"
                    ? "max-w-[440px]"
                    : "max-w-[500px]"
                : "max-w-[540px]",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              aria-label="Close action panel"
              className={cn(
                "absolute right-3 z-10 flex size-8 items-center justify-center rounded-lg border border-cyan-100/30 bg-[#08151d]/95 text-base font-semibold leading-none text-cyan-50 shadow-lg backdrop-blur-xl hover:bg-[#0d1f2b]",
                immersiveActionPanel ? "top-2" : "top-3",
              )}
              onClick={() => setOverlay(undefined)}
              type="button"
            >
              ×
            </button>
            <Suspense fallback={null}>{panel}</Suspense>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function WorldExperience() {
  const { address, authenticated, wallet, walletConnected } = usePrivyWallet();
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId>();
  const [initialChainAligned, setInitialChainAligned] = useState(false);
  const [manualChainSelectionError, setManualChainSelectionError] = useState<
    string | undefined
  >();
  const [manualChainSelectionPending, setManualChainSelectionPending] =
    useState<ChainSlug | undefined>();
  const setWallet = useAppStore((state) => state.setWallet);
  const setRoom = useAppStore((state) => state.setRoom);
  const hydratePortfolio = useAppStore((state) => state.hydratePortfolio);
  const hydrateMinions = useAppStore((state) => state.hydrateMinions);
  const setPendingJobs = useAppStore((state) => state.setPendingJobs);
  const clearLocalPresence = useAppStore((state) => state.clearLocalPresence);
  const localPresence = useAppStore((state) => state.presence.local);
  const remotePresence = useAppStore((state) => state.presence.remote);
  const activeChain = useAppStore((state) => state.session.activeChain);
  const setNearbyTarget = useAppStore((state) => state.setNearbyTarget);

  const ensNameQuery = useQuery({
    enabled: Boolean(address),
    queryKey: ["ens-name", address],
    queryFn: () => resolveEnsName(address!),
    staleTime: 300_000,
    gcTime: 1_800_000,
    retry: 1,
  });

  const checksumAddress = useMemo(
    () => (address && isAddress(address) ? getAddress(address) : undefined),
    [address],
  );
  const apiPortfolioQuery = useQuery({
    enabled: Boolean(address),
    queryKey: ["portfolio", address, activeChain],
    queryFn: async () => fetchPortfolio(address!),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1_800_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const shouldUseClientFallback = apiPortfolioQuery.isError;

  const activeNativeBalance = useBalance({
    address: checksumAddress,
    chainId: NATIVE_CHAIN_IDS[activeChain],
    query: {
      enabled: Boolean(checksumAddress) && shouldUseClientFallback,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1_800_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  const supportedErc20Tokens = useMemo(
    () => getSupportedErc20Tokens(activeChain),
    [activeChain],
  );
  const erc20BalanceContracts = useMemo(() => {
    if (!checksumAddress || supportedErc20Tokens.length === 0) {
      return [];
    }

    return supportedErc20Tokens.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [checksumAddress],
      chainId: NATIVE_CHAIN_IDS[activeChain],
    }));
  }, [activeChain, checksumAddress, supportedErc20Tokens]);
  const erc20BalancesQuery = useReadContracts({
    contracts: erc20BalanceContracts,
    allowFailure: true,
    query: {
      enabled:
        Boolean(checksumAddress) &&
        erc20BalanceContracts.length > 0 &&
        shouldUseClientFallback,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1_800_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  const walletChainQuery = useQuery({
    enabled: Boolean(authenticated && wallet),
    queryKey: ["wallet-chain", wallet?.address],
    queryFn: async () => {
      if (!wallet) {
        return undefined;
      }
      return getConnectedWalletChainState(wallet);
    },
    staleTime: 5_000,
  });
  const walletChainState = walletChainQuery.data;
  const walletChain = walletChainState?.chain;
  const walletChainPending = walletChainQuery.isPending;

  const walletAssetsQuery = useQuery({
    enabled: Boolean(wallet) && Boolean(address) && shouldUseClientFallback,
    queryKey: ["wallet-assets", address, activeChain],
    queryFn: async () =>
      wallet ? fetchWalletPortfolio(wallet, activeChain) : [],
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1_800_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const wagmiAssets = useMemo(() => {
    const nativeAsset = toPortfolioAssetFromNativeBalance(
      activeChain,
      activeNativeBalance.data?.value,
      activeNativeBalance.data?.formatted,
    );
    const readResults = erc20BalancesQuery.data ?? [];
    const erc20Assets = supportedErc20Tokens.flatMap((token, index) => {
      const value = resolveReadContractBigInt(readResults[index]);
      if (!value || value <= 0n) {
        return [];
      }

      const asset: PortfolioAsset = {
        chain: activeChain,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        balance: formatUnits(value, token.decimals),
        decimals: token.decimals,
        usdValue: 0,
        verified: true,
      };
      return [asset];
    });

    return nativeAsset ? [nativeAsset, ...erc20Assets] : erc20Assets;
  }, [
    activeChain,
    activeNativeBalance.data?.formatted,
    activeNativeBalance.data?.value,
    erc20BalancesQuery.data,
    supportedErc20Tokens,
  ]);

  const walletChainAssets = useMemo(
    () =>
      (walletAssetsQuery.data ?? []).filter(
        (asset) => asset.chain === activeChain,
      ),
    [activeChain, walletAssetsQuery.data],
  );
  const apiChainAssets = useMemo(
    () =>
      (apiPortfolioQuery.data ?? []).filter(
        (asset) => asset.chain === activeChain,
      ),
    [activeChain, apiPortfolioQuery.data],
  );

  const portfolioAssets = useMemo(
    () =>
      shouldUseClientFallback
        ? mergePortfolioAssets(wagmiAssets, walletChainAssets, apiChainAssets)
        : apiChainAssets,
    [apiChainAssets, shouldUseClientFallback, wagmiAssets, walletChainAssets],
  );

  useQuery({
    enabled: Boolean(address),
    queryKey: ["bridge-jobs", address],
    queryFn: async () => {
      const jobs = await fetchBridgeJobs(address!);
      setPendingJobs(jobs);
      return jobs;
    },
  });

  useEffect(() => {
    setWallet(address);
  }, [address, setWallet]);

  useEffect(() => {
    if (!authenticated || !wallet) {
      setInitialChainAligned(false);
      setManualChainSelectionError(undefined);
      setManualChainSelectionPending(undefined);
      return;
    }
    setInitialChainAligned(false);
    setManualChainSelectionError(undefined);
    setManualChainSelectionPending(undefined);
  }, [authenticated, wallet?.address]);

  useEffect(() => {
    if (
      !authenticated ||
      !wallet ||
      walletChainPending ||
      initialChainAligned
    ) {
      return;
    }

    if (!walletChainState?.supported || !walletChainState.chain) {
      return;
    }

    if (walletChainState.chain !== activeChain) {
      setRoom(ROOM_BY_CHAIN[walletChainState.chain]);
      return;
    }

    setInitialChainAligned(true);
  }, [
    activeChain,
    authenticated,
    initialChainAligned,
    setRoom,
    wallet,
    walletChainState?.chain,
    walletChainState?.supported,
    walletChain,
    walletChainPending,
  ]);

  useEffect(() => {
    if (!address) {
      hydratePortfolio([]);
      return;
    }

    hydratePortfolio(portfolioAssets);
  }, [address, hydratePortfolio, portfolioAssets]);

  useEffect(() => {
    if (!address) {
      hydrateMinions([], 0, []);
      return;
    }

    const registryEntries = runtimeConfig.protocolRegistry;

    const supportedAssetKeys = new Set(
      registryEntries.flatMap((entry) =>
        entry.supportedTokens
          .map((token) => toAssetKey(token.chain, token.address))
          .filter((key): key is string => Boolean(key)),
      ),
    );
    const { minions, summary } = deriveMinions(
      portfolioAssets,
      supportedAssetKeys,
    );
    hydrateMinions(minions, summary.total, summary.visibleSymbols);
  }, [activeChain, address, hydrateMinions, portfolioAssets]);

  useEffect(() => {
    if (!localPresence) {
      setNearbyTarget(undefined);
      return;
    }

    const localAddress = localPresence.address.toLowerCase();
    const maxDistanceSq = 8 * 8;
    let nearestAddress: string | undefined;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;

    for (const snapshot of Object.values(remotePresence)) {
      const remoteAddress = snapshot.address?.toLowerCase();
      if (!remoteAddress || remoteAddress === localAddress) {
        continue;
      }
      const dx = snapshot.position.x - localPresence.position.x;
      const dz = snapshot.position.z - localPresence.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestAddress = snapshot.address;
      }
    }

    setNearbyTarget(
      nearestDistanceSq <= maxDistanceSq ? nearestAddress : undefined,
    );
  }, [localPresence, remotePresence, setNearbyTarget]);

  useEffect(() => {
    if (!walletConnected || !authenticated || typeof window === "undefined") {
      setSelectedAvatar(undefined);
      return;
    }

    const storageKey = address
      ? avatarStorageKey(address)
      : "cryptoworld:selected-avatar:guest";
    const savedAvatar = window.localStorage.getItem(storageKey);
    setSelectedAvatar(isAvatarId(savedAvatar) ? savedAvatar : undefined);
  }, [address, authenticated, walletConnected]);

  useEffect(() => {
    if (!walletConnected || !authenticated || !selectedAvatar) {
      clearLocalPresence();
    }
  }, [authenticated, clearLocalPresence, selectedAvatar, walletConnected]);

  const displayName = ensNameQuery.data ?? shortenIdentity(address);
  const needsManualChainSelection =
    walletConnected &&
    authenticated &&
    Boolean(wallet) &&
    !initialChainAligned &&
    !walletChainPending &&
    (!walletChainState?.supported || !walletChainState.chain);
  const unsupportedChainId =
    walletChainState?.resolved && walletChainState.supported === false
      ? walletChainState.chainId
      : undefined;
  const needsCharacterSelection =
    walletConnected &&
    authenticated &&
    !needsManualChainSelection &&
    !selectedAvatar;
  const waitingForSpawnAlignment =
    walletConnected &&
    authenticated &&
    Boolean(wallet) &&
    !initialChainAligned &&
    (walletChainPending ||
      !walletChainState?.supported ||
      !walletChainState.chain ||
      walletChainState.chain !== activeChain);

  const handleManualChainSelection = async (chain: ChainSlug) => {
    if (!wallet) {
      return;
    }
    setManualChainSelectionError(undefined);
    setManualChainSelectionPending(chain);
    try {
      await ensureWalletChain(wallet, chain);
      setRoom(ROOM_BY_CHAIN[chain]);
      setInitialChainAligned(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setManualChainSelectionError(message);
    } finally {
      setManualChainSelectionPending(undefined);
    }
  };

  usePartyPresence();

  return (
    <main className="relative h-dvh overflow-hidden bg-[#08161e]">
      {!walletConnected ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/95 px-6">
          <div className="max-w-xl">
            <ConnectPanel compact />
            <p className="mt-4 text-center text-sm text-cyan-100/70 text-pretty">
              Connect a wallet to enter synchronized multiplayer islands with
              live send, swap, and bridge flows.
            </p>
          </div>
        </div>
      ) : null}
      {needsCharacterSelection ? (
        <CharacterSelectOverlay
          onSelect={(avatarId) => {
            setSelectedAvatar(avatarId);
            if (typeof window === "undefined") {
              return;
            }
            const storageKey = address
              ? avatarStorageKey(address)
              : "cryptoworld:selected-avatar:guest";
            window.localStorage.setItem(storageKey, avatarId);
          }}
        />
      ) : null}
      {needsManualChainSelection ? (
        <ChainSelectionOverlay
          chainId={unsupportedChainId}
          error={manualChainSelectionError}
          onSelect={(chain) => {
            void handleManualChainSelection(chain);
          }}
          pendingChain={manualChainSelectionPending}
        />
      ) : null}
      {!walletConnected || waitingForSpawnAlignment ? null : (
        <Suspense fallback={null}>
          <LazyCryptoWorldScene
            avatarId={selectedAvatar}
            displayName={displayName}
          />
        </Suspense>
      )}
      {walletConnected ? <WorldHud /> : null}
    </main>
  );
}
