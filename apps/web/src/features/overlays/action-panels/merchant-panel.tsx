import {
  cancelSeaportListing,
  createSeaportListingOrder,
  fulfillChainAtlasListing,
  submitOpenSeaFulfillmentTransaction,
} from "@/features/merchant/seaport";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import {
  fetchOpenSeaRequiredFees,
  fetchOpenSeaFulfillment,
  fetchOpenSeaListings,
  fetchWalletNfts,
  publishOpenSeaListing,
  type WalletNft,
} from "@/lib/api/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { env } from "@/lib/config/env";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { serverMessageSchema } from "@chainatlas/shared";
import type {
  ChainSlug,
  MerchantListing,
  MerchantShop,
  WorldRoomId,
} from "@chainatlas/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { formatEther, getAddress, parseEther } from "viem";
import { ActionButton, InlineError, shortAddress } from "./shared";

type MerchantTab = "browse" | "my-listings" | "import" | "create";
type OwnerMerchantTab = Exclude<MerchantTab, "browse">;
const merchantPrimaryButtonClass =
  "border-[#82744e] bg-[#2d2b21] text-[#e3d3a8] hover:border-[#9a8a5d] hover:bg-[#383327]";
const merchantUtilityButtonClass =
  "border-[#6f6447] bg-[#1f2119] text-[#d9c89e] hover:border-[#8d7d56] hover:bg-[#2a2c22]";
const MERCHANT_SLOT_COUNT = 8;

function nftKey(contractAddress: string, tokenId: string) {
  return `${contractAddress.toLowerCase()}:${tokenId}`;
}

function resolveImageUrl(url?: string) {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("ipfs://")) {
    const ipfsPath = trimmed.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${ipfsPath}`;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return trimmed;
}

function normalizeMerchantError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("opensea request failed")) {
    const jsonMatch = message.match(/OpenSea request failed \(\d+\):\s*(\{[\s\S]*\})/i);
    if (jsonMatch?.[1]) {
      try {
        const payload = JSON.parse(jsonMatch[1]) as { errors?: unknown };
        if (Array.isArray(payload.errors) && payload.errors.length > 0) {
          const first = payload.errors[0];
          if (typeof first === "string" && first.trim().length > 0) {
            return first.trim();
          }
        }
      } catch {
        // Fall through to default message normalization.
      }
    }
  }
  if (
    lowered.includes("call_exception") ||
    lowered.includes("execution reverted") ||
    lowered.includes("ownerof(") ||
    lowered.includes("ownerof") ||
    lowered.includes("balanceof(") ||
    lowered.includes("balanceof")
  ) {
    return "That NFT cannot be listed here. Only ERC-721 and ERC-1155 tokens owned by your connected wallet on this chain are supported.";
  }
  if (lowered.includes("not owned by this wallet")) {
    return "That NFT is not owned by your connected wallet on this chain.";
  }
  if (message.length > 220) {
    return `${message.slice(0, 220)}...`;
  }
  return message;
}

function normalizeListings(listings: MerchantListing[]) {
  const deduped = new Map<string, MerchantListing>();
  for (const listing of listings) {
    const key =
      listing.orderHash?.toLowerCase() ?? listing.listingId.toLowerCase();
    deduped.set(key, listing);
  }
  return [...deduped.values()]
    .filter((listing) => listing.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MERCHANT_SLOT_COUNT);
}

function parseNumberishValue(value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return undefined;
}

function parseListingDisplayPriceWei(listing: MerchantListing) {
  const order =
    listing.seaportOrder && typeof listing.seaportOrder === "object"
      ? (listing.seaportOrder as Record<string, unknown>)
      : undefined;
  const parameters =
    order?.parameters && typeof order.parameters === "object"
      ? (order.parameters as Record<string, unknown>)
      : undefined;
  const consideration = Array.isArray(parameters?.consideration)
    ? (parameters.consideration as Array<Record<string, unknown>>)
    : [];
  if (consideration.length > 0) {
    let total = 0n;
    let consumed = false;
    for (const item of consideration) {
      const rawType = item.itemType ?? item.item_type;
      const normalizedType =
        typeof rawType === "string" ? rawType.trim().toLowerCase() : rawType;
      const isNative =
        normalizedType === 0 ||
        normalizedType === "0" ||
        normalizedType === "native" ||
        normalizedType === "native_token";
      if (!isNative) {
        continue;
      }
      const amount = parseNumberishValue(
        item.startAmount ?? item.start_amount ?? item.endAmount ?? item.end_amount,
      );
      if (!amount) {
        continue;
      }
      try {
        total += BigInt(amount);
        consumed = true;
      } catch {
        // Ignore malformed consideration amounts.
      }
    }
    if (consumed) {
      return total.toString();
    }
  }
  return listing.priceWei;
}

function toJsonSafeString(value: unknown) {
  return JSON.stringify(value, (_key, nextValue) =>
    typeof nextValue === "bigint" ? nextValue.toString() : nextValue,
  );
}

function buildShop(input: {
  existing?: MerchantShop;
  address: string;
  sellerDisplayName?: string;
  sellerAvatarId?: MerchantShop["sellerAvatarId"];
  chain: ChainSlug;
  roomId: WorldRoomId;
  anchor: { x: number; y: number; z: number };
  listings: MerchantListing[];
}) {
  return {
    seller: input.address,
    sellerDisplayName:
      input.sellerDisplayName ??
      input.existing?.sellerDisplayName ??
      shortAddress(input.address),
    sellerAvatarId: input.sellerAvatarId ?? input.existing?.sellerAvatarId,
    chain: input.chain,
    roomId: input.roomId,
    mode: "clone",
    anchor: input.anchor,
    updatedAt: Date.now(),
    listings: normalizeListings(input.listings),
  } satisfies MerchantShop;
}

function MerchantFrame({
  children,
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#6f6447] bg-[#12130f]/98 p-2.5 shadow-2xl">
      <div className="rounded-xl border border-[#746949] bg-[#212219] px-2 py-1.5">
        <p className="text-xs font-semibold text-[#b6a06a] text-balance">
          Bazaar Ledger
        </p>
        <h2 className="mt-0.5 text-base font-semibold text-[#e7d9b3] text-balance">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-[#c6b387] text-pretty">{subtitle}</p>
      </div>
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "rounded-xl border px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[#928257] bg-[#2e2c21] text-[#e8dbb9]"
          : "border-[#5f563f] bg-[#1b1d16] text-[#bfae83] hover:border-[#796c49] hover:bg-[#25271e]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MerchantListingCard({
  listing,
  owner,
  onBuy,
  onCancel,
  pending,
}: {
  listing: MerchantListing;
  owner: boolean;
  pending: boolean;
  onBuy(): void;
  onCancel(): void;
}) {
  const listingImageUrl = resolveImageUrl(listing.imageUrl);
  const listingDisplayPriceWei = parseListingDisplayPriceWei(listing);
  return (
    <article className="rounded-xl border border-[#655c42] bg-[#181a14] p-2.5">
      <div className="flex items-start gap-3">
        <div className="size-14 overflow-hidden rounded-lg border border-[#6f6447] bg-[#23261e]">
          {listingImageUrl ? (
            <img
              alt={listing.tokenName}
              className="size-full object-cover"
              src={listingImageUrl}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-[#0f120d] text-[10px] font-semibold text-[#8f815f]">
              NFT
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#e6d8b5]">
            {listing.tokenName}
          </p>
          <p className="text-xs text-[#c5b487] text-pretty">
            {listing.collectionName} · #{listing.tokenId}
          </p>
          <p className="mt-1 text-sm font-medium text-[#d7c08a] tabular-nums">
            {Number(formatEther(BigInt(listingDisplayPriceWei))).toFixed(4)} ETH
          </p>
          <p className="text-xs text-[#ae9f7a]">
            {shortAddress(listing.seller)}
          </p>
        </div>
      </div>
      <div className="mt-2">
        {owner ? (
          <ActionButton
            className="border-[#7b5d4f] bg-[#2f2621] text-[#e0cab7] hover:border-[#92705e] hover:bg-[#3a2e28]"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel listing
          </ActionButton>
        ) : (
          <ActionButton
            className={merchantPrimaryButtonClass}
            disabled={pending}
            onClick={onBuy}
          >
            Buy item
          </ActionButton>
        )}
      </div>
    </article>
  );
}

export function MerchantPanel() {
  const { address, wallet } = usePrivyWallet();
  const overlays = useAppStore((state) => state.overlays);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const setMerchantTab = useAppStore((state) => state.setMerchantTab);
  const connectedAddress = useAppStore((state) => state.session.connectedAddress);
  const activeChain = useAppStore((state) => state.session.activeChain);
  const currentRoomId = useAppStore((state) => state.session.currentRoomId);
  const localPresence = useAppStore((state) => state.presence.local);
  const merchantShops = useAppStore((state) => state.merchants.shops);
  const partySocket = useAppStore((state) => state.partySocket);

  const [priceInput, setPriceInput] = useState("0.10");
  const [selectedNftKey, setSelectedNftKey] = useState<string>();
  const [pricePromptOpen, setPricePromptOpen] = useState(false);
  const [stagedSlotIndex, setStagedSlotIndex] = useState<number>();
  const [draggingSlotIndex, setDraggingSlotIndex] = useState<number>();
  const [selectedBuyListingId, setSelectedBuyListingId] = useState<string>();
  const [buyBoardSlotIndex, setBuyBoardSlotIndex] = useState<number>();
  const [buyBoardDragOverIndex, setBuyBoardDragOverIndex] = useState<number>();
  const [buyConfirmListingId, setBuyConfirmListingId] = useState<string>();
  const [localError, setLocalError] = useState<string>();

  const ownerAddressLower = (address ?? connectedAddress)?.toLowerCase();
  const selectedSeller = (
    overlays.nearbyMerchantSeller ?? address ?? connectedAddress
  )?.toLowerCase();
  const selectedShop = selectedSeller
    ? merchantShops[selectedSeller]
    : undefined;
  const isOwner = Boolean(
    ownerAddressLower &&
      selectedSeller &&
      ownerAddressLower === selectedSeller,
  );
  const ownerTab: OwnerMerchantTab =
    overlays.merchantTab === "import" ||
    overlays.merchantTab === "create" ||
    overlays.merchantTab === "my-listings"
      ? overlays.merchantTab
      : "my-listings";
  const activeTab: MerchantTab = isOwner ? ownerTab : "browse";

  const nftQuery = useQuery({
    enabled: Boolean(isOwner && address),
    queryKey: ["wallet-nfts", address, activeChain],
    queryFn: async () => {
      if (!address) {
        return [];
      }
      const collected = new Map<string, WalletNft>();
      let cursor: string | undefined;
      for (let page = 0; page < 30; page += 1) {
        const response = await fetchWalletNfts(address, activeChain, cursor);
        for (const nft of response.nfts) {
          const key = nftKey(nft.contractAddress, nft.tokenId);
          if (!collected.has(key)) {
            collected.set(key, nft);
          }
        }
        if (!response.nextCursor) {
          break;
        }
        cursor = response.nextCursor;
      }
      return [...collected.values()];
    },
    staleTime: 60_000,
  });
  const openSeaListingsQuery = useQuery({
    enabled: Boolean(isOwner && address),
    queryKey: ["wallet-opensea-listings", address, activeChain],
    queryFn: async () => {
      if (!address) {
        return [];
      }
      const response = await fetchOpenSeaListings(address, activeChain, 50);
      return response.listings.filter(
        (listing) =>
          listing.source === "opensea" && listing.status === "active",
      );
    },
    staleTime: 60_000,
  });
  const sellerNftsQuery = useQuery({
    enabled: Boolean(
      selectedShop &&
        selectedShop.listings.some((listing) => !resolveImageUrl(listing.imageUrl)),
    ),
    queryKey: [
      "seller-wallet-nfts",
      selectedShop?.seller.toLowerCase(),
      activeChain,
    ],
    queryFn: async () => {
      if (!selectedShop?.seller) {
        return new Map<string, WalletNft>();
      }
      const collected = new Map<string, WalletNft>();
      let cursor: string | undefined;
      for (let page = 0; page < 12; page += 1) {
        const response = await fetchWalletNfts(
          selectedShop.seller,
          activeChain,
          cursor,
        );
        for (const nft of response.nfts) {
          const key = nftKey(nft.contractAddress, nft.tokenId);
          if (!collected.has(key)) {
            collected.set(key, nft);
          }
        }
        if (!response.nextCursor) {
          break;
        }
        cursor = response.nextCursor;
      }
      return collected;
    },
    staleTime: 60_000,
  });

  const nfts = nftQuery.data ?? [];
  const candidateWalletNfts = useMemo(() => nfts, [nfts]);
  const openSeaListedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const listing of openSeaListingsQuery.data ?? []) {
      keys.add(nftKey(listing.nftContract, listing.tokenId));
    }
    return keys;
  }, [openSeaListingsQuery.data]);
  const uncertainStandardNftsCount = useMemo(
    () =>
      nfts.filter(
        (nft) => !nft.tokenStandard || nft.tokenStandard === "unknown",
      ).length,
    [nfts],
  );
  const listableNfts = useMemo(
    () =>
      candidateWalletNfts.filter(
        (nft) =>
          !openSeaListedKeys.has(nftKey(nft.contractAddress, nft.tokenId)),
      ),
    [candidateWalletNfts, openSeaListedKeys],
  );

  useEffect(() => {
    if (!selectedNftKey) {
      return;
    }
    const stillAvailable = listableNfts.some(
      (item) => nftKey(item.contractAddress, item.tokenId) === selectedNftKey,
    );
    if (!stillAvailable) {
      setSelectedNftKey(undefined);
    }
  }, [listableNfts, selectedNftKey]);

  const selectedNft = useMemo<WalletNft | undefined>(
    () =>
      selectedNftKey
        ? listableNfts.find(
            (item) =>
              nftKey(item.contractAddress, item.tokenId) === selectedNftKey,
          )
        : undefined,
    [listableNfts, selectedNftKey],
  );

  useEffect(() => {
    if (!selectedNft && pricePromptOpen) {
      setPricePromptOpen(false);
      setStagedSlotIndex(undefined);
    }
  }, [pricePromptOpen, selectedNft]);

  const sendShop = (
    shop: MerchantShop,
    type: "merchant:upsert-shop" | "merchant:sync-external",
  ) => {
    if (!partySocket || partySocket.readyState !== 1) {
      throw new Error("Realtime merchant socket is not connected");
    }
    if (
      !localPresence?.address ||
      localPresence.address.toLowerCase() !== shop.seller.toLowerCase()
    ) {
      throw new Error(
        "Avatar sync is not ready yet. Move once and retry listing.",
      );
    }
    if (
      localPresence.chain !== shop.chain ||
      localPresence.roomId !== shop.roomId
    ) {
      throw new Error(
        "Merchant room/chain is out of sync with your live avatar. Move once and retry.",
      );
    }
    const expectedSeller = shop.seller.toLowerCase();
    const previousShop = useAppStore.getState().merchants.shops[expectedSeller];
    const previousUpdatedAt = previousShop?.updatedAt;
    const expectRemoval = shop.listings.length === 0;
    const requiredListingId =
      type === "merchant:upsert-shop" && shop.listings.length > 0
        ? shop.listings[shop.listings.length - 1]?.listingId
        : undefined;
    const hadRequiredListing = Boolean(
      requiredListingId &&
        previousShop?.listings.some(
          (listing) => listing.listingId === requiredListingId,
        ),
    );
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const onMessage = (event: MessageEvent) => {
        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = serverMessageSchema.safeParse(parsedPayload);
        if (!parsed.success) {
          return;
        }
        const message = parsed.data;
        if (message.type === "room:error" || message.type === "merchant:error") {
          cleanup();
          reject(new Error(message.payload.message));
          return;
        }
        if (message.type === "merchant:upserted") {
          const upsertedSeller = message.payload.shop.seller.toLowerCase();
          if (upsertedSeller !== expectedSeller || expectRemoval) {
            return;
          }
          if (
            !requiredListingId ||
            message.payload.shop.listings.some(
              (listing) => listing.listingId === requiredListingId,
            )
          ) {
            cleanup();
            resolve();
          }
          return;
        }
        if (message.type === "merchant:listing-removed" && expectRemoval) {
          if (message.payload.seller.toLowerCase() === expectedSeller) {
            cleanup();
            resolve();
          }
          return;
        }
        if (message.type === "merchant:snapshot") {
          const snapshotShop = message.payload.shops.find(
            (candidate) =>
              candidate.seller.toLowerCase() === expectedSeller,
          );
          if (expectRemoval) {
            if (!snapshotShop || snapshotShop.listings.length === 0) {
              cleanup();
              resolve();
            }
            return;
          }
          if (
            snapshotShop &&
            (!requiredListingId ||
              snapshotShop.listings.some(
                (listing) => listing.listingId === requiredListingId,
              ))
          ) {
            cleanup();
            resolve();
          }
        }
      };
      const pollId = window.setInterval(() => {
        const syncedShop = useAppStore.getState().merchants.shops[expectedSeller];
        if (expectRemoval) {
          if (!syncedShop || syncedShop.listings.length === 0) {
            cleanup();
            resolve();
            return;
          }
        } else if (
          syncedShop &&
          syncedShop.updatedAt !== previousUpdatedAt &&
          (!requiredListingId ||
            syncedShop.listings.some(
              (listing) => listing.listingId === requiredListingId,
            ))
        ) {
          cleanup();
          resolve();
          return;
        } else if (
          syncedShop &&
          requiredListingId &&
          !hadRequiredListing &&
          syncedShop.listings.some(
            (listing) => listing.listingId === requiredListingId,
          )
        ) {
          // Fallback when server/client clocks differ and updatedAt comparison
          // is unreliable.
          cleanup();
          resolve();
          return;
        }

        if (Date.now() >= deadline) {
          cleanup();
          reject(
            new Error(
              `Merchant sync timed out on Party host ${env.partyHost}. Check host/deploy, then retry.`,
            ),
          );
        }
      }, 120);

      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Merchant sync timed out on Party host ${env.partyHost}. Check host/deploy, then retry.`,
          ),
        );
      }, 10_000);

      const cleanup = () => {
        window.clearInterval(pollId);
        window.clearTimeout(timeoutId);
        partySocket.removeEventListener("message", onMessage);
      };

      try {
        partySocket.addEventListener("message", onMessage);
        partySocket.send(
          toJsonSafeString({
            type,
            payload: { shop },
          }),
        );
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const createListingMutation = useMutation({
    mutationFn: async () => {
      setLocalError(undefined);
      if (!wallet || !address || !selectedNft) {
        throw new Error("Select an NFT and connect a wallet before listing.");
      }
      const parsedPrice = parseEther(priceInput);
      const requiredFees = await fetchOpenSeaRequiredFees(
        activeChain,
        getAddress(selectedNft.contractAddress),
        selectedNft.tokenId,
      );
      const seaportOrder = await createSeaportListingOrder({
        wallet,
        chain: activeChain,
        seller: address,
        nftContract: getAddress(selectedNft.contractAddress),
        tokenId: selectedNft.tokenId,
        tokenStandard:
          selectedNft.tokenStandard === "erc1155"
            ? "erc1155"
            : selectedNft.tokenStandard === "erc721"
              ? "erc721"
              : "unknown",
        priceWei: parsedPrice.toString(),
        requiredFeeSplits: requiredFees.fees,
      });
      const publishResult = await publishOpenSeaListing({
        chain: activeChain,
        order: seaportOrder.order,
      });
      const publishedOrderHash =
        publishResult.orderHash ?? seaportOrder.orderHash;
      const listing: MerchantListing = {
        listingId: publishedOrderHash ?? `chainatlas:${Date.now()}`,
        orderHash: publishedOrderHash,
        source: "chainatlas",
        status: "active",
        seller: address,
        chain: activeChain,
        nftContract: getAddress(selectedNft.contractAddress).toLowerCase(),
        tokenId: selectedNft.tokenId,
        collectionName: selectedNft.collectionName,
        tokenName: selectedNft.tokenName,
        imageUrl: selectedNft.imageUrl,
        priceWei: parsedPrice.toString(),
        currencySymbol: "ETH",
        expiry: seaportOrder.expiry,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        seaportOrder: seaportOrder.order as Record<string, unknown>,
      };
      const nextShop = buildShop({
        existing: selectedShop,
        address,
        sellerDisplayName:
          localPresence?.displayName ??
          selectedShop?.sellerDisplayName ??
          shortAddress(address),
        sellerAvatarId: localPresence?.avatarId ?? selectedShop?.sellerAvatarId,
        chain: localPresence?.chain ?? activeChain,
        roomId: localPresence?.roomId ?? currentRoomId,
        anchor: localPresence?.position ??
          selectedShop?.anchor ?? { x: 0, y: 1.2, z: 0 },
        listings: [...(selectedShop?.listings ?? []), listing],
      });
      await sendShop(nextShop, "merchant:upsert-shop");
      setMerchantTab("my-listings");
      return listing;
    },
    onError(error) {
      const message = normalizeMerchantError(error);
      setLocalError(message);
      toast.error("Listing failed", { description: message });
    },
    onSuccess() {
      setPricePromptOpen(false);
      setSelectedNftKey(undefined);
      setStagedSlotIndex(undefined);
      setPriceInput("0.10");
      toast.success("Listing published", {
        description: "Your merchant stall listing is now live.",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      setLocalError(undefined);
      if (!address) {
        throw new Error("Connect wallet before importing listings.");
      }
      const result = await fetchOpenSeaListings(address, activeChain, 20);
      const nextShop = buildShop({
        existing: selectedShop,
        address,
        sellerDisplayName:
          localPresence?.displayName ??
          selectedShop?.sellerDisplayName ??
          shortAddress(address),
        sellerAvatarId: localPresence?.avatarId ?? selectedShop?.sellerAvatarId,
        chain: localPresence?.chain ?? activeChain,
        roomId: localPresence?.roomId ?? currentRoomId,
        anchor: localPresence?.position ??
          selectedShop?.anchor ?? { x: 0, y: 1.2, z: 0 },
        listings: result.listings,
      });
      await sendShop(nextShop, "merchant:sync-external");
      setMerchantTab("my-listings");
      return result.listings.length;
    },
    onError(error) {
      const message = normalizeMerchantError(error);
      setLocalError(message);
      toast.error("Import failed", { description: message });
    },
    onSuccess(count) {
      toast.success("Listings imported", {
        description: `${count} listing${count === 1 ? "" : "s"} synced.`,
      });
    },
  });
  const breakStallMutation = useMutation({
    mutationFn: async () => {
      setLocalError(undefined);
      if (!address) {
        throw new Error("Connect wallet before breaking the merchant stall.");
      }
      const nextShop = buildShop({
        existing: selectedShop,
        address,
        sellerDisplayName:
          localPresence?.displayName ??
          selectedShop?.sellerDisplayName ??
          shortAddress(address),
        sellerAvatarId: localPresence?.avatarId ?? selectedShop?.sellerAvatarId,
        chain: localPresence?.chain ?? activeChain,
        roomId: localPresence?.roomId ?? currentRoomId,
        anchor:
          localPresence?.position ?? selectedShop?.anchor ?? { x: 0, y: 1.2, z: 0 },
        listings: [],
      });
      await sendShop(nextShop, "merchant:upsert-shop");
      setOverlay(undefined);
    },
    onError(error) {
      const message = normalizeMerchantError(error);
      setLocalError(message);
      toast.error("Break stall failed", { description: message });
    },
    onSuccess() {
      toast.success("Merchant stall removed");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (listing: MerchantListing) => {
      if (!address || !wallet) {
        throw new Error("Connect wallet before canceling listings.");
      }
      if (!partySocket || partySocket.readyState !== 1) {
        throw new Error("Realtime merchant socket is unavailable.");
      }
      if (listing.seller.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Only the listing seller can cancel this order.");
      }
      if (!listing.seaportOrder || typeof listing.seaportOrder !== "object") {
        throw new Error(
          "Listing is missing order payload required for OpenSea cancellation. Re-import listing and retry.",
        );
      }
      await cancelSeaportListing({
        wallet,
        chain: listing.chain,
        seller: address,
        listing,
      });
      partySocket.send(
        JSON.stringify({
          type: "merchant:cancel-listing",
          payload: {
            seller: address,
            listingId: listing.listingId,
          },
        }),
      );
    },
    onError(error) {
      const message = normalizeMerchantError(error);
      setLocalError(message);
      toast.error("Cancel failed", { description: message });
    },
    onSuccess() {
      toast.success("Listing cancellation submitted");
    },
  });

  const buyMutation = useMutation({
    mutationFn: async (listing: MerchantListing) => {
      if (!wallet || !address) {
        throw new Error("Connect wallet before buying listings.");
      }
      if (!partySocket || partySocket.readyState !== 1) {
        throw new Error("Realtime merchant socket is unavailable.");
      }
      if (listing.source === "chainatlas") {
        await fulfillChainAtlasListing({
          wallet,
          buyer: address,
          chain: listing.chain,
          listing,
        });
      } else {
        if (!listing.orderHash) {
          throw new Error("External listing missing order hash");
        }
        const fulfillment = await fetchOpenSeaFulfillment({
          chain: listing.chain,
          orderHash: listing.orderHash,
          fulfiller: address,
          nftContract: listing.nftContract,
          tokenId: listing.tokenId,
        });
        await submitOpenSeaFulfillmentTransaction({
          wallet,
          chain: listing.chain,
          to: fulfillment.to,
          data: fulfillment.data,
          value: fulfillment.value,
        });
      }
      partySocket.send(
        JSON.stringify({
          type: "merchant:mark-fulfilled",
          payload: {
            seller: listing.seller,
            listingId: listing.listingId,
          },
        }),
      );
      setOverlay(undefined);
    },
    onError(error) {
      const message = normalizeMerchantError(error);
      setLocalError(message);
      setBuyConfirmListingId(undefined);
      setBuyBoardSlotIndex(undefined);
      setSelectedBuyListingId(undefined);
      toast.error("Purchase failed", { description: message });
    },
    onSuccess() {
      toast.success("Purchase submitted");
    },
  });

  const listings = selectedShop?.listings ?? [];
  const walletNftsByListingKey = useMemo(() => {
    const map = new Map<string, WalletNft>();
    for (const nft of nfts) {
      map.set(nftKey(nft.contractAddress, nft.tokenId), nft);
    }
    return map;
  }, [nfts]);
  const sellerNftsByListingKey = sellerNftsQuery.data ?? new Map<string, WalletNft>();
  const hydratedListings = useMemo(
    () =>
      listings.map((listing) => {
        const key = nftKey(listing.nftContract, listing.tokenId);
        const fallbackNft =
          walletNftsByListingKey.get(key) ?? sellerNftsByListingKey.get(key);
        if (!fallbackNft) {
          return listing;
        }
        const nextImageUrl =
          resolveImageUrl(listing.imageUrl) ??
          resolveImageUrl(fallbackNft.imageUrl) ??
          listing.imageUrl;
        const nextTokenName =
          listing.tokenName.startsWith("NFT #") && fallbackNft.tokenName
            ? fallbackNft.tokenName
            : listing.tokenName;
        const nextCollectionName =
          listing.collectionName === "Collection" && fallbackNft.collectionName
            ? fallbackNft.collectionName
            : listing.collectionName;
        if (
          nextImageUrl === listing.imageUrl &&
          nextTokenName === listing.tokenName &&
          nextCollectionName === listing.collectionName
        ) {
          return listing;
        }
        return {
          ...listing,
          imageUrl: nextImageUrl,
          tokenName: nextTokenName,
          collectionName: nextCollectionName,
        };
      }),
    [listings, sellerNftsByListingKey, walletNftsByListingKey],
  );
  const merchantGridListings = useMemo(
    () =>
      hydratedListings
        .filter((listing) => listing.status === "active")
        .slice(0, MERCHANT_SLOT_COUNT),
    [hydratedListings],
  );
  const selectedBuyListing = useMemo(
    () =>
      merchantGridListings.find(
        (listing) => listing.listingId === selectedBuyListingId,
      ),
    [merchantGridListings, selectedBuyListingId],
  );
  const buyConfirmListing = useMemo(
    () =>
      merchantGridListings.find(
        (listing) => listing.listingId === buyConfirmListingId,
      ),
    [buyConfirmListingId, merchantGridListings],
  );
  const buyConfirmImageUrl = resolveImageUrl(buyConfirmListing?.imageUrl);

  useEffect(() => {
    if (!selectedBuyListingId) {
      return;
    }
    const exists = merchantGridListings.some(
      (listing) => listing.listingId === selectedBuyListingId,
    );
    if (!exists) {
      setSelectedBuyListingId(undefined);
      setBuyBoardSlotIndex(undefined);
      setBuyConfirmListingId(undefined);
    }
  }, [merchantGridListings, selectedBuyListingId]);

  const merchantSlotsFull = merchantGridListings.length >= MERCHANT_SLOT_COUNT;

  const stageNftForListing = (key: string, slotIndex?: number) => {
    const exists = listableNfts.some(
      (item) => nftKey(item.contractAddress, item.tokenId) === key,
    );
    if (!exists) {
      return;
    }
    const resolvedSlotIndex =
      slotIndex ??
      (merchantGridListings.length < MERCHANT_SLOT_COUNT
        ? merchantGridListings.length
        : -1);
    if (merchantSlotsFull || resolvedSlotIndex < 0) {
      setLocalError(
        "Merchant slots are full. Cancel one listing before adding another.",
      );
      return;
    }
    setLocalError(undefined);
    setSelectedNftKey(key);
    setPricePromptOpen(true);
    setStagedSlotIndex(resolvedSlotIndex);
  };
  const panelTitle = isOwner ? "Your Merchant Stall" : "Merchant Stall";
  const panelSubtitle = isOwner
    ? "List and manage your stall items."
    : selectedShop
      ? `Inspect items from ${shortAddress(selectedShop.seller)} and buy directly from the stall.`
      : "No nearby merchant listings.";

  return (
    <MerchantFrame subtitle={panelSubtitle} title={panelTitle}>
      {isOwner ? (
        <div className="flex flex-wrap gap-1.5">
          <TabButton
            active={activeTab === "my-listings"}
            label="My Listings"
            onClick={() => setMerchantTab("my-listings")}
          />
          <TabButton
            active={activeTab === "import"}
            label="Import Existing"
            onClick={() => setMerchantTab("import")}
          />
          <TabButton
            active={activeTab === "create"}
            label="Create Listing"
            onClick={() => setMerchantTab("create")}
          />
        </div>
      ) : null}
      {isOwner && selectedShop ? (
        <ActionButton
          className="border-[#7b4d4d] bg-[#2b1b1b] text-[#e4c3c3] hover:border-[#966060] hover:bg-[#382323]"
          disabled={breakStallMutation.isPending}
          onClick={() => breakStallMutation.mutate()}
        >
          {breakStallMutation.isPending
            ? "Breaking merchant..."
            : "Break Merchant Stall"}
        </ActionButton>
      ) : null}

      {!selectedShop ? (
        <p className="rounded-xl border border-[#655c42] bg-[#181a14] px-2.5 py-1.5 text-xs text-[#c6b387] text-pretty">
          Merchant has no active listings right now.
        </p>
      ) : null}

      {selectedShop && activeTab === "my-listings" ? (
        <div className="space-y-2">
          {hydratedListings.length === 0 ? (
            <p className="rounded-xl border border-[#655c42] bg-[#181a14] px-2.5 py-1.5 text-xs text-[#c6b387] text-pretty">
              No active listings.
            </p>
          ) : (
            hydratedListings.map((listing) => (
              <MerchantListingCard
                key={listing.listingId}
                listing={listing}
                onBuy={() => buyMutation.mutate(listing)}
                onCancel={() => cancelMutation.mutate(listing)}
                owner
                pending={buyMutation.isPending || cancelMutation.isPending}
              />
            ))
          )}
        </div>
      ) : null}

      {selectedShop && activeTab === "browse" && !isOwner ? (
        <div className="relative space-y-1.5 rounded-xl border border-[#655c42] bg-[#181a14] p-1.5">
          {listings.length === 0 ? (
            <p className="rounded-xl border border-[#655c42] bg-[#181a14] px-2.5 py-1.5 text-xs text-[#c6b387] text-pretty">
              No active listings.
            </p>
          ) : (
            <>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-[#c7b284]">
                  Merchant Items
                </p>
                <div className="relative w-full rounded-xl border border-[#6f6447] bg-[#20231b] p-1.5">
                  <TooltipProvider delayDuration={80}>
                    <div className="grid grid-cols-4 gap-1.5">
                      {Array.from({ length: MERCHANT_SLOT_COUNT }, (_, slotIndex) => {
                        const listing = merchantGridListings[slotIndex];
                        if (!listing) {
                          return (
                            <div
                              className="aspect-square w-full border border-[#3f3a2b] bg-[#0d0f0b]"
                              key={`browse-empty-slot-${slotIndex}`}
                            />
                          );
                        }
                        const active = selectedBuyListingId === listing.listingId;
                        const listingImageUrl = resolveImageUrl(listing.imageUrl);
                        const listingPrice = Number(
                          formatEther(BigInt(parseListingDisplayPriceWei(listing))),
                        ).toFixed(4);
                        return (
                          <Tooltip key={listing.listingId}>
                            <TooltipTrigger asChild>
                              <button
                                className={cn(
                                  "group relative aspect-square w-full overflow-hidden rounded-lg border p-0.5 text-left transition-colors",
                                  active
                                    ? "border-[#9a8860] bg-[#2d3024]"
                                    : "border-[#534c38] bg-[#181b14] hover:border-[#7e704e]",
                                )}
                                draggable
                                onClick={() => {
                                  setSelectedBuyListingId(listing.listingId);
                                  setBuyConfirmListingId(undefined);
                                }}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData(
                                    "text/merchant-listing-id",
                                    listing.listingId,
                                  );
                                  event.dataTransfer.setData("text/plain", listing.listingId);
                                  event.dataTransfer.effectAllowed = "copy";
                                }}
                                type="button"
                              >
                                {listingImageUrl ? (
                                  <img
                                    alt={listing.tokenName}
                                    className="size-full object-cover transition-opacity group-hover:opacity-95"
                                    src={listingImageUrl}
                                  />
                                ) : (
                                  <div className="flex size-full items-center justify-center bg-[#11140f] text-[10px] font-semibold text-[#8f815f]">
                                    NFT
                                  </div>
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              className="max-w-52 truncate border-[#7b6f4f] bg-[#10120d]/95 text-[#dcc99a]"
                              side="top"
                            >
                              {listing.tokenName} · {listingPrice} ETH
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </TooltipProvider>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold text-[#c7b284]">
                  Buyer Inventory
                </p>
                <div className="relative w-full rounded-xl border border-[#6f6447] bg-[#20231b] p-1.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: MERCHANT_SLOT_COUNT }, (_, slotIndex) => {
                      const isFilled =
                        buyBoardSlotIndex === slotIndex && Boolean(selectedBuyListing);
                      const selectedBuyImageUrl = resolveImageUrl(
                        selectedBuyListing?.imageUrl,
                      );
                      return (
                        <button
                          className={cn(
                            "relative aspect-square w-full overflow-hidden rounded-lg border p-0.5 text-left transition-colors",
                            isFilled
                              ? "border-[#9a8860] bg-[#2d3024]"
                              : buyBoardDragOverIndex === slotIndex
                                ? "border-[#a99666] bg-[#313426]"
                                : "border-[#534c38] bg-[#181b14]",
                          )}
                          key={`buyer-tray-slot-${slotIndex}`}
                          onClick={() => {
                            if (isFilled) {
                              setBuyBoardSlotIndex(undefined);
                              setSelectedBuyListingId(undefined);
                              setBuyConfirmListingId(undefined);
                            }
                          }}
                          onDragLeave={() => {
                            if (buyBoardDragOverIndex === slotIndex) {
                              setBuyBoardDragOverIndex(undefined);
                            }
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "copy";
                            setBuyBoardDragOverIndex(slotIndex);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setBuyBoardDragOverIndex(undefined);
                            const listingId =
                              event.dataTransfer.getData("text/merchant-listing-id") ||
                              event.dataTransfer.getData("text/plain");
                            if (!listingId) {
                              return;
                            }
                            const targetListing = merchantGridListings.find(
                              (listing) => listing.listingId === listingId,
                            );
                            if (!targetListing) {
                              return;
                            }
                            setSelectedBuyListingId(targetListing.listingId);
                            setBuyBoardSlotIndex(slotIndex);
                            setBuyConfirmListingId(targetListing.listingId);
                          }}
                          type="button"
                        >
                          {isFilled && selectedBuyImageUrl ? (
                            <img
                              alt={selectedBuyListing?.tokenName ?? "Selected NFT"}
                              className="size-full object-cover"
                              src={selectedBuyImageUrl}
                            />
                          ) : (
                            <div className="size-full border border-[#3f3a2b] bg-[#0d0f0b]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 rounded-lg border border-[#5d543d] bg-[#151711] px-2 py-1 text-[11px] text-[#bdaa7f]">
                    Drag an item into any tray slot to open purchase confirmation.
                  </div>
                </div>
              </div>
              {buyConfirmListing ? (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <div className="pointer-events-auto absolute top-1/2 left-1/2 w-56 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#8b7a52] bg-[#15170f] p-1.5 shadow-2xl">
                    <div className="flex items-center gap-1.5">
                      <div className="size-8 overflow-hidden rounded-md border border-[#6f6447] bg-[#0f120d]">
                        {buyConfirmImageUrl ? (
                          <img
                            alt={buyConfirmListing.tokenName}
                            className="size-full object-cover"
                            src={buyConfirmImageUrl}
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-[9px] font-semibold text-[#8f815f]">
                            NFT
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-[#e7d9b3]">
                          {buyConfirmListing.tokenName}
                        </p>
                        <p className="text-[11px] text-[#bca97e] tabular-nums">
                          {Number(
                            formatEther(
                              BigInt(parseListingDisplayPriceWei(buyConfirmListing)),
                            ),
                          ).toFixed(4)} ETH
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      <button
                        className="rounded-lg border border-[#645a41] bg-[#181b14] px-1.5 py-1 text-[11px] font-medium text-[#c8b583] transition-colors hover:border-[#85764f] hover:text-[#e7d9b3]"
                        onClick={() => {
                          setBuyConfirmListingId(undefined);
                          setBuyBoardSlotIndex(undefined);
                          setSelectedBuyListingId(undefined);
                        }}
                        type="button"
                      >
                        Not now
                      </button>
                      <ActionButton
                        className={merchantPrimaryButtonClass}
                        disabled={buyMutation.isPending}
                        onClick={() => buyMutation.mutate(buyConfirmListing)}
                      >
                        {buyMutation.isPending ? "..." : "Buy"}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {isOwner && activeTab === "import" ? (
        <div className="rounded-xl border border-[#655c42] bg-[#181a14] p-2.5">
          <p className="text-xs text-[#c6b387] text-pretty">
            Pull your active OpenSea listings on this island chain and merge
            them into your merchant stall.
          </p>
          <div className="mt-2">
            <ActionButton
              className={merchantUtilityButtonClass}
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending
                ? "Syncing..."
                : "Sync OpenSea Listings"}
            </ActionButton>
          </div>
        </div>
      ) : null}

      {isOwner && activeTab === "create" ? (
        <div className="space-y-1.5 rounded-xl border border-[#655c42] bg-[#181a14] p-1.5">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-[#c7b284]">
              Merchant Board
            </p>
            <div className="w-full rounded-xl border border-[#6f6447] bg-[#20231b] p-1">
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: MERCHANT_SLOT_COUNT }, (_, slotIndex) => {
                  const listedItem = merchantGridListings[slotIndex];
                  const isDropTarget = !listedItem;
                  const isStagedSlot = stagedSlotIndex === slotIndex;
                  const slotLabel = listedItem
                    ? listedItem.tokenName
                    : isStagedSlot && selectedNft
                      ? selectedNft.tokenName
                      : "Empty slot";
                  const slotImage =
                    resolveImageUrl(listedItem?.imageUrl) ??
                    (isStagedSlot ? resolveImageUrl(selectedNft?.imageUrl) : undefined);

                  return (
                    <button
                      className={cn(
                        "relative aspect-square w-full overflow-hidden rounded-lg border p-0.5 text-left transition-colors",
                        listedItem
                          ? "cursor-default border-[#6f6447] bg-[#161912]"
                          : isStagedSlot
                            ? "border-[#9a8860] bg-[#2d3024]"
                            : "border-[#534c38] bg-[#181b14] hover:border-[#7e704e]",
                        draggingSlotIndex === slotIndex
                          ? "border-[#a99666] bg-[#313426]"
                          : "",
                      )}
                      key={`merchant-slot-${slotIndex}`}
                      onClick={() => {
                        if (listedItem) {
                          return;
                        }
                        if (selectedNftKey) {
                          setStagedSlotIndex(slotIndex);
                          setPricePromptOpen(true);
                        }
                      }}
                      onDragLeave={() => {
                        if (draggingSlotIndex === slotIndex) {
                          setDraggingSlotIndex(undefined);
                        }
                      }}
                      onDragOver={(event) => {
                        if (!isDropTarget) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                        setDraggingSlotIndex(slotIndex);
                      }}
                      onDrop={(event) => {
                        if (!isDropTarget) {
                          return;
                        }
                        event.preventDefault();
                        setDraggingSlotIndex(undefined);
                        const key =
                          event.dataTransfer.getData("text/merchant-nft-key") ||
                          event.dataTransfer.getData("text/plain");
                        if (key) {
                          stageNftForListing(key, slotIndex);
                        }
                      }}
                      type="button"
                    >
                      {slotImage ? (
                        <img
                          alt={slotLabel}
                          className="size-full object-cover"
                          src={slotImage}
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center border border-dashed border-[#5f563f] bg-[#11130f] text-[9px] text-[#8d7f5d]">
                          Empty
                        </div>
                      )}
                      {listedItem ? (
                        <span className="absolute bottom-1 left-1 bg-[#11130f]/95 px-1 py-0.5 text-[10px] text-[#c7b284]">
                          Listed
                        </span>
                      ) : null}
                      {isStagedSlot && !listedItem ? (
                        <span className="absolute bottom-1 right-1 bg-[#11130f]/95 px-1 py-0.5 text-[10px] text-[#d7c08a]">
                          Staged
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[9px] text-[#9f916e]">
                Drag from inventory into an empty square, then set price.
              </p>
            </div>
          </div>

          {pricePromptOpen && selectedNft ? (
            <div className="rounded-xl border border-[#6f6447] bg-[#20231b] p-1.5">
              <p className="text-xs font-semibold text-[#e7d9b3]">
                Set listing price
              </p>
              <p className="mt-0.5 text-xs text-[#b8a67d]">
                {selectedNft.collectionName} · {selectedNft.tokenName}
              </p>
              <label className="mt-1.5 block">
                <span className="mb-1 block text-[11px] font-medium text-[#ccb885]">
                  Price (ETH)
                </span>
                <input
                  className="w-full rounded-xl border border-[#665d43] bg-[#171a13] px-2 py-1.5 text-sm text-[#e7d9b3] outline-none placeholder:text-[#8d7f5d] focus:border-[#8f7e56]"
                  inputMode="decimal"
                  onChange={(event) => setPriceInput(event.target.value)}
                  placeholder="0.10"
                  type="text"
                  value={priceInput}
                />
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  className="rounded-xl border border-[#645a41] bg-[#181b14] px-2 py-1.5 text-sm font-medium text-[#c8b583] transition-colors hover:border-[#85764f] hover:text-[#e7d9b3]"
                  onClick={() => {
                    setPricePromptOpen(false);
                    setStagedSlotIndex(undefined);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <ActionButton
                  className={merchantPrimaryButtonClass}
                  disabled={
                    createListingMutation.isPending || nftQuery.isPending
                  }
                  onClick={() => createListingMutation.mutate()}
                >
                  {createListingMutation.isPending
                    ? "Signing order..."
                    : "List item"}
                </ActionButton>
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-[11px] font-medium text-[#ccb885]">
              Your Inventory
            </p>
            <p className="mb-1.5 text-[10px] text-[#a1916d]">
              {listableNfts.length} listable of {nfts.length} owned on this
              chain.
            </p>
            {uncertainStandardNftsCount > 0 ? (
              <p className="mb-1.5 text-[10px] text-[#9f916e]">
                {uncertainStandardNftsCount} NFTs have unknown standard and are
                still listable.
              </p>
            ) : null}
            {nftQuery.isPending ? (
              <p className="mb-2 text-[11px] text-[#a1916d]">
                Loading wallet NFTs...
              </p>
            ) : null}
            {nftQuery.isSuccess && nfts.length === 0 ? (
              <p className="mb-2 text-[11px] text-[#a1916d]">
                No NFTs detected for this wallet on the current chain.
              </p>
            ) : null}
            {nftQuery.isError ? (
              <p className="mb-2 text-[11px] text-[#d49a8c]">
                Could not load wallet NFTs. Check API base URL and Worker
                secrets.
              </p>
            ) : null}
            <div className="max-h-28 overflow-y-auto rounded-xl border border-[#6f6447] bg-[#11130f] p-1">
              <div className="grid grid-cols-7 gap-1">
                {Array.from(
                  { length: Math.max(14, listableNfts.length) },
                  (_, index) => {
                    const nft = listableNfts[index];
                    if (!nft) {
                      return (
                        <div
                          className="aspect-square border border-[#3f3a2b] bg-[#0d0f0b]"
                          key={`inventory-empty-${index}`}
                        />
                      );
                    }
                    const value = nftKey(nft.contractAddress, nft.tokenId);
                    const active = selectedNftKey === value;
                    return (
                      <button
                        className={cn(
                          "group aspect-square border p-0.5 text-left transition-colors",
                          active
                            ? "border-[#97875d] bg-[#2d3024]"
                            : "border-[#4e4836] bg-[#151812] hover:border-[#7d704d] hover:bg-[#1f231a]",
                        )}
                        draggable
                        key={value}
                        onClick={() => stageNftForListing(value)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "text/merchant-nft-key",
                            value,
                          );
                          event.dataTransfer.setData("text/plain", value);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        title={`${nft.collectionName} · ${nft.tokenName}`}
                        type="button"
                      >
                        <div className="size-full overflow-hidden border border-[#6b6145] bg-[#0f120d]">
                          {nft.imageUrl ? (
                            (() => {
                              const nftImageUrl = resolveImageUrl(nft.imageUrl);
                              if (!nftImageUrl) {
                                return (
                                  <div className="flex size-full items-center justify-center bg-[#0f120d] text-[10px] font-semibold text-[#8f815f]">
                                    NFT
                                  </div>
                                );
                              }
                              return (
                                <img
                                  alt={nft.tokenName}
                                  className="size-full object-cover transition-opacity group-hover:opacity-95"
                                  src={nftImageUrl}
                                />
                              );
                            })()
                          ) : (
                            <div className="flex size-full items-center justify-center bg-[#0f120d] text-[10px] font-semibold text-[#8f815f]">
                              NFT
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <InlineError message={localError} />
    </MerchantFrame>
  );
}
