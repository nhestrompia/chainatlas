import { usePartyPresence } from "@/features/presence/use-party-presence";
import { resumeBridge } from "@/features/transactions/bridge";
import { ConnectPanel } from "@/features/wallet/connect-panel";
import {
  ensureWalletChain,
  fetchWalletPortfolio,
  getConnectedWalletChainState,
  resolveEnsName,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import {
  fetchBridgeJobs,
  fetchOpenSeaListings,
  fetchPortfolio,
} from "@/lib/api/client";
import { runtimeConfig } from "@/lib/config/runtime";
import { deriveMinions } from "@/lib/minions";
import { useAppStore } from "@/lib/store/app-store";
import {
  type AvatarId,
  type ChainSlug,
  type PortfolioAsset,
} from "@chainatlas/shared";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, getAddress, isAddress } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { NATIVE_CHAIN_IDS, ROOM_BY_CHAIN } from "./world-experience/constants";
import {
  avatarStorageKey,
  getSupportedErc20Tokens,
  isAvatarId,
  mergePortfolioAssets,
  resolveReadContractBigInt,
  shortenIdentity,
  toAssetKey,
  toPortfolioAssetFromNativeBalance,
} from "./world-experience/helpers";
import {
  ChainSelectionOverlay,
  CharacterSelectOverlay,
} from "./world-experience/overlays";
import { WorldHud } from "./world-experience/world-hud";

const LazyChainAtlasScene = lazy(() =>
  import("@/scene/components/chain-atlas-scene").then((module) => ({
    default: module.ChainAtlasScene,
  })),
);

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
  const jobs = useAppStore((state) => state.pendingTransactions.jobs);
  const clearLocalPresence = useAppStore((state) => state.clearLocalPresence);
  const localPresence = useAppStore((state) => state.presence.local);
  const remotePresence = useAppStore((state) => state.presence.remote);
  const merchantShops = useAppStore((state) => state.merchants.shops);
  const activeChain = useAppStore((state) => state.session.activeChain);
  const currentRoomId = useAppStore((state) => state.session.currentRoomId);
  const setNearbyTarget = useAppStore((state) => state.setNearbyTarget);
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const setNearbyMerchantSeller = useAppStore(
    (state) => state.setNearbyMerchantSeller,
  );
  const nearbyMerchantSeller = useAppStore(
    (state) => state.overlays.nearbyMerchantSeller,
  );
  const ownMerchantShop = useMemo(
    () => (address ? merchantShops[address.toLowerCase()] : undefined),
    [address, merchantShops],
  );
  const externalSyncKeysRef = useRef<Set<string>>(new Set());
  const observedBridgeStatusesRef = useRef<Map<string, string>>(new Map());

  const ensNameQuery = useQuery({
    enabled: Boolean(address),
    queryKey: ["ens-name", address],
    queryFn: async () => (await resolveEnsName(address!)) ?? null,
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
  const pendingAcrossJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.protocol === "across" &&
          ["submitted", "settling", "quote_ready"].includes(job.status) &&
          Boolean(job.originChainId) &&
          Boolean(job.depositId),
      ),
    [jobs],
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
  useQuery({
    enabled: Boolean(address) && pendingAcrossJobs.length > 0,
    queryKey: [
      "bridge-jobs-status-sync",
      address,
      pendingAcrossJobs
        .map((job) => `${job.id}:${job.status}:${job.updatedAt}`)
        .join("|"),
    ],
    queryFn: async () => {
      await Promise.allSettled(
        pendingAcrossJobs.map((job) => resumeBridge(job)),
      );
      const refreshedJobs = await fetchBridgeJobs(address!);
      setPendingJobs(refreshedJobs);
      return refreshedJobs;
    },
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const nextStatuses = new Map<string, string>();
    for (const job of jobs) {
      const previousStatus = observedBridgeStatusesRef.current.get(job.id);
      if (
        previousStatus &&
        previousStatus !== "completed" &&
        job.status === "completed"
      ) {
        toast.success(
          `Bridge to ${runtimeConfig.chains[job.destinationChain].label} completed`,
        );
      }
      nextStatuses.set(job.id, job.status);
    }
    observedBridgeStatusesRef.current = nextStatuses;
  }, [jobs]);

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
    const maxDistanceSq = 14 * 14;
    const switchBias = 0.8;
    const normalizedCurrentTarget = nearbyTarget?.toLowerCase();
    let nearestAddress: string | undefined;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let currentDistanceSq = Number.POSITIVE_INFINITY;

    for (const snapshot of Object.values(remotePresence)) {
      const remoteAddress = snapshot.address?.toLowerCase();
      if (!remoteAddress || remoteAddress === localAddress) {
        continue;
      }
      const dx = snapshot.position.x - localPresence.position.x;
      const dz = snapshot.position.z - localPresence.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (remoteAddress === normalizedCurrentTarget) {
        currentDistanceSq = distanceSq;
      }
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestAddress = snapshot.address;
      }
    }

    if (nearestDistanceSq > maxDistanceSq || !nearestAddress) {
      setNearbyTarget(undefined);
      return;
    }

    if (
      nearbyTarget &&
      currentDistanceSq <= maxDistanceSq &&
      nearestAddress.toLowerCase() !== normalizedCurrentTarget &&
      nearestDistanceSq >= currentDistanceSq * switchBias
    ) {
      // Keep the current nearby player locked unless another is meaningfully closer.
      setNearbyTarget(nearbyTarget);
      return;
    }

    setNearbyTarget(nearestAddress);
  }, [localPresence, nearbyTarget, remotePresence, setNearbyTarget]);

  useEffect(() => {
    if (!localPresence) {
      setNearbyMerchantSeller(undefined);
      return;
    }

    const localAddress = localPresence.address.toLowerCase();
    const maxDistanceSq = 14 * 14;
    const switchBias = 0.82;
    const normalizedCurrentSeller = nearbyMerchantSeller?.toLowerCase();
    let nearestSeller: string | undefined;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let currentDistanceSq = Number.POSITIVE_INFINITY;
    for (const shop of Object.values(merchantShops)) {
      const seller = shop.seller.toLowerCase();
      if (
        seller === localAddress ||
        shop.roomId !== currentRoomId ||
        shop.chain !== activeChain
      ) {
        continue;
      }
      const sourcePosition =
        shop.mode === "mobile"
          ? Object.values(remotePresence).find(
              (presence) => presence.address.toLowerCase() === seller,
            )?.position
          : shop.anchor;
      if (!sourcePosition) {
        continue;
      }
      const dx = sourcePosition.x - localPresence.position.x;
      const dz = sourcePosition.z - localPresence.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (seller === normalizedCurrentSeller) {
        currentDistanceSq = distanceSq;
      }
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestSeller = shop.seller;
      }
    }

    if (!nearestSeller || nearestDistanceSq > maxDistanceSq) {
      setNearbyMerchantSeller(undefined);
      return;
    }
    if (
      nearbyMerchantSeller &&
      currentDistanceSq <= maxDistanceSq &&
      nearestSeller.toLowerCase() !== normalizedCurrentSeller &&
      nearestDistanceSq >= currentDistanceSq * switchBias
    ) {
      setNearbyMerchantSeller(nearbyMerchantSeller);
      return;
    }

    setNearbyMerchantSeller(nearestSeller);
  }, [
    activeChain,
    currentRoomId,
    localPresence,
    merchantShops,
    nearbyMerchantSeller,
    remotePresence,
    setNearbyMerchantSeller,
  ]);

  useEffect(() => {
    if (!walletConnected || !authenticated || typeof window === "undefined") {
      setSelectedAvatar(undefined);
      return;
    }

    const storageKey = address
      ? avatarStorageKey(address)
      : "chainatlas:selected-avatar:guest";
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

  const partySocket = usePartyPresence();

  useEffect(() => {
    if (
      !partySocket ||
      partySocket.readyState !== 1 ||
      !walletConnected ||
      !authenticated ||
      !address
    ) {
      return;
    }
    const syncKey = `${address.toLowerCase()}:${activeChain}:${currentRoomId}`;
    if (externalSyncKeysRef.current.has(syncKey)) {
      return;
    }

    let cancelled = false;
    const syncListingsOnce = async () => {
      externalSyncKeysRef.current.add(syncKey);
      try {
        const result = await fetchOpenSeaListings(address, activeChain, 20);
        if (cancelled) {
          return;
        }
        partySocket.send(
          JSON.stringify({
            type: "merchant:sync-external",
            payload: {
              shop: {
                seller: address,
                chain: activeChain,
                roomId: currentRoomId,
                mode: ownMerchantShop?.mode ?? "clone",
                anchor: ownMerchantShop?.anchor ?? {
                  x: activeChain === "ethereum" ? -58 : 58,
                  y: 1.2,
                  z: 0,
                },
                updatedAt: Date.now(),
                listings: result.listings,
              },
            },
          }),
        );
      } catch {
        // Keep UI live even if OpenSea throttles.
      }
    };

    void syncListingsOnce();
    return () => {
      cancelled = true;
    };
  }, [
    activeChain,
    address,
    authenticated,
    currentRoomId,
    ownMerchantShop?.anchor,
    ownMerchantShop?.mode,
    partySocket,
    walletConnected,
  ]);

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
              : "chainatlas:selected-avatar:guest";
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
          <LazyChainAtlasScene
            avatarId={selectedAvatar}
            displayName={displayName}
          />
        </Suspense>
      )}
      {walletConnected ? <WorldHud /> : null}
    </main>
  );
}
