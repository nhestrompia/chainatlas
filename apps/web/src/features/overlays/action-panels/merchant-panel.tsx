import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { formatEther, getAddress, parseEther } from "viem";
import type { MerchantListing, MerchantShop } from "@chainatlas/shared";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { createSeaportListingOrder, fulfillChainAtlasListing, submitOpenSeaFulfillmentTransaction } from "@/features/merchant/seaport";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchOpenSeaFulfillment,
  fetchOpenSeaListings,
  fetchWalletNfts,
  type WalletNft,
} from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { ActionButton, InlineError, shortAddress } from "./shared";

type MerchantTab = "browse" | "my-listings" | "import" | "create";
const merchantPrimaryButtonClass =
  "border-[#d7b56f]/80 bg-gradient-to-r from-[#8f3f21] to-[#b15a2e] text-[#fff4db] hover:border-[#efd19a] hover:from-[#a34a27] hover:to-[#c86c38]";
const merchantUtilityButtonClass =
  "border-[#c79e54]/55 bg-[#3a2314] text-[#f2ddae] hover:border-[#dfbe79] hover:bg-[#4a2c18]";

function normalizeListings(listings: MerchantListing[]) {
  const deduped = new Map<string, MerchantListing>();
  for (const listing of listings) {
    const key = listing.orderHash?.toLowerCase() ?? listing.listingId.toLowerCase();
    deduped.set(key, listing);
  }
  return [...deduped.values()]
    .filter((listing) => listing.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
}

function buildShop(input: {
  existing?: MerchantShop;
  address: string;
  chain: "ethereum" | "base";
  roomId: "ethereum:main" | "base:main";
  anchor: { x: number; y: number; z: number };
  listings: MerchantListing[];
}) {
  return {
    seller: input.address,
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
    <section className="rounded-2xl border border-[#c89f55]/45 bg-gradient-to-b from-[#1e140d]/96 to-[#2a1a10]/96 p-4 shadow-2xl">
      <div className="rounded-xl border border-[#d5ac63]/55 bg-gradient-to-r from-[#4a2b17]/95 to-[#65381d]/95 px-3 py-2">
        <p className="text-xs font-semibold text-[#e6c27c] text-balance">Bazaar Ledger</p>
        <h2 className="mt-1 text-xl font-semibold text-[#fff0d0] text-balance">{title}</h2>
        <p className="mt-1 text-sm text-[#f2dbab] text-pretty">{subtitle}</p>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
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
        "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-[#e5c98c] bg-gradient-to-r from-[#6f2d18] to-[#8a3f20] text-[#fff0d0]"
          : "border-[#b78d4a]/45 bg-[#2f1c12] text-[#efdbb2] hover:border-[#d7b56f] hover:bg-[#3d2416]",
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
  return (
    <article className="rounded-xl border border-[#bb9452]/40 bg-[#2d1a11]/90 p-3">
      <div className="flex items-start gap-3">
        <div className="size-16 overflow-hidden rounded-lg border border-[#c79e54]/45 bg-[#4a301d]">
          {listing.imageUrl ? (
            <img
              alt={listing.tokenName}
              className="size-full object-cover"
              src={listing.imageUrl}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#fff0d0]">{listing.tokenName}</p>
          <p className="text-xs text-[#e6cda0] text-pretty">
            {listing.collectionName} · #{listing.tokenId}
          </p>
          <p className="mt-1 text-sm font-medium text-[#f0c66f] tabular-nums">
            {Number(formatEther(BigInt(listing.priceWei))).toFixed(4)} ETH
          </p>
          <p className="text-xs text-[#ceb888]">{shortAddress(listing.seller)}</p>
        </div>
      </div>
      <div className="mt-3">
        {owner ? (
          <ActionButton
            className="border-[#e08a6b]/55 bg-[#5a271f] text-[#ffd9c9] hover:border-[#f2a488] hover:bg-[#703128]"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel listing
          </ActionButton>
        ) : (
          <ActionButton className={merchantPrimaryButtonClass} disabled={pending} onClick={onBuy}>
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
  const activeChain = useAppStore((state) => state.session.activeChain);
  const currentRoomId = useAppStore((state) => state.session.currentRoomId);
  const localPresence = useAppStore((state) => state.presence.local);
  const merchantShops = useAppStore((state) => state.merchants.shops);
  const partySocket = useAppStore((state) => state.partySocket);

  const [priceInput, setPriceInput] = useState("0.10");
  const [selectedNftKey, setSelectedNftKey] = useState<string>();
  const [localError, setLocalError] = useState<string>();

  const addressLower = address?.toLowerCase();
  const selectedSeller = (overlays.nearbyMerchantSeller ?? address)?.toLowerCase();
  const selectedShop = selectedSeller ? merchantShops[selectedSeller] : undefined;
  const isOwner = Boolean(addressLower && selectedSeller && addressLower === selectedSeller);
  const activeTab: MerchantTab =
    isOwner ? ((overlays.merchantTab as MerchantTab | undefined) ?? "my-listings") : "browse";

  const nftQuery = useQuery({
    enabled: Boolean(isOwner && address),
    queryKey: ["wallet-nfts", address, activeChain],
    queryFn: async () => {
      if (!address) {
        return [];
      }
      const first = await fetchWalletNfts(address, activeChain);
      return first.nfts;
    },
    staleTime: 60_000,
  });

  const nfts = nftQuery.data ?? [];
  const selectedNft = useMemo<WalletNft | undefined>(
    () =>
      selectedNftKey
        ? nfts.find(
            (item) =>
              `${item.contractAddress.toLowerCase()}:${item.tokenId}` === selectedNftKey,
          )
        : undefined,
    [nfts, selectedNftKey],
  );

  const sendShop = (shop: MerchantShop, type: "merchant:upsert-shop" | "merchant:sync-external") => {
    if (!partySocket || partySocket.readyState !== 1) {
      throw new Error("Realtime merchant socket is not connected");
    }
    partySocket.send(
      JSON.stringify({
        type,
        payload: { shop },
      }),
    );
  };

  const createListingMutation = useMutation({
    mutationFn: async () => {
      setLocalError(undefined);
      if (!wallet || !address || !selectedNft) {
        throw new Error("Select an NFT and connect a wallet before listing.");
      }
      const parsedPrice = parseEther(priceInput);
      const seaportOrder = await createSeaportListingOrder({
        wallet,
        chain: activeChain,
        seller: address,
        nftContract: getAddress(selectedNft.contractAddress),
        tokenId: selectedNft.tokenId,
        priceWei: parsedPrice.toString(),
      });
      const listing: MerchantListing = {
        listingId: seaportOrder.orderHash ?? `chainatlas:${Date.now()}`,
        orderHash: seaportOrder.orderHash,
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
        chain: activeChain,
        roomId: currentRoomId,
        anchor: localPresence?.position ?? selectedShop?.anchor ?? { x: 0, y: 1.2, z: 0 },
        listings: [...(selectedShop?.listings ?? []), listing],
      });
      sendShop(nextShop, "merchant:upsert-shop");
      setMerchantTab("my-listings");
      return listing;
    },
    onError(error) {
      setLocalError(error instanceof Error ? error.message : String(error));
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
        chain: activeChain,
        roomId: currentRoomId,
        anchor: localPresence?.position ?? selectedShop?.anchor ?? { x: 0, y: 1.2, z: 0 },
        listings: result.listings,
      });
      sendShop(nextShop, "merchant:sync-external");
      setMerchantTab("my-listings");
      return result.listings.length;
    },
    onError(error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (listingId: string) => {
      if (!partySocket || partySocket.readyState !== 1 || !address) {
        throw new Error("Realtime merchant socket is unavailable.");
      }
      partySocket.send(
        JSON.stringify({
          type: "merchant:cancel-listing",
          payload: {
            seller: address,
            listingId,
          },
        }),
      );
    },
    onError(error) {
      setLocalError(error instanceof Error ? error.message : String(error));
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
      setLocalError(error instanceof Error ? error.message : String(error));
    },
  });

  const listings = selectedShop?.listings ?? [];
  const panelTitle = isOwner ? "Your Merchant Stall" : "Merchant Stall";
  const panelSubtitle = isOwner
    ? "Manage your merchant stall and sync existing OpenSea asks."
    : selectedShop
      ? `Inspect items from ${shortAddress(selectedShop.seller)} and buy directly from the stall.`
      : "No nearby merchant listings.";

  return (
    <MerchantFrame subtitle={panelSubtitle} title={panelTitle}>
      {isOwner ? (
        <div className="flex flex-wrap gap-2">
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

      {!selectedShop ? (
        <p className="rounded-xl border border-[#bb9452]/40 bg-[#2d1a11]/90 px-3 py-2 text-sm text-[#ebd4a8] text-pretty">
          Merchant has no active listings right now.
        </p>
      ) : null}

      {selectedShop && (activeTab === "browse" || activeTab === "my-listings") ? (
        <div className="space-y-2">
          {listings.length === 0 ? (
            <p className="rounded-xl border border-[#bb9452]/40 bg-[#2d1a11]/90 px-3 py-2 text-sm text-[#ebd4a8] text-pretty">
              No active listings.
            </p>
          ) : (
            listings.map((listing) => (
              <MerchantListingCard
                key={listing.listingId}
                listing={listing}
                onBuy={() => buyMutation.mutate(listing)}
                onCancel={() => cancelMutation.mutate(listing.listingId)}
                owner={isOwner}
                pending={buyMutation.isPending || cancelMutation.isPending}
              />
            ))
          )}
        </div>
      ) : null}

      {isOwner && activeTab === "import" ? (
        <div className="rounded-xl border border-[#bb9452]/40 bg-[#2d1a11]/90 p-3">
          <p className="text-sm text-[#ebd4a8] text-pretty">
            Pull your active OpenSea listings on this island chain and merge them into your merchant stall.
          </p>
          <div className="mt-3">
            <ActionButton
              className={merchantUtilityButtonClass}
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending ? "Syncing..." : "Sync OpenSea Listings"}
            </ActionButton>
          </div>
        </div>
      ) : null}

      {isOwner && activeTab === "create" ? (
        <div className="space-y-3 rounded-xl border border-[#bb9452]/40 bg-[#2d1a11]/90 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[#f0c66f]">NFT</span>
            <Select
              onValueChange={(value) => setSelectedNftKey(value === "__merchant_nft_empty__" ? undefined : value)}
              value={selectedNftKey ?? "__merchant_nft_empty__"}
            >
              <SelectTrigger className="border-[#c79e54]/55 bg-[#4a2c18] text-[#fff0d0] hover:border-[#d7b56f] focus:border-[#e5c98c] focus-visible:ring-[#e5c98c]/25">
                <SelectValue placeholder="Select wallet NFT" />
              </SelectTrigger>
              <SelectContent className="border-[#c79e54]/65 bg-[#2f1c12]/96 text-[#fff0d0]">
                <SelectItem
                  className="focus:bg-[#5f3a21] focus:text-[#fff2d5]"
                  value="__merchant_nft_empty__"
                >
                  Select wallet NFT
                </SelectItem>
                {nfts.map((nft) => {
                  const value = `${nft.contractAddress.toLowerCase()}:${nft.tokenId}`;
                  return (
                    <SelectItem
                      className="focus:bg-[#5f3a21] focus:text-[#fff2d5]"
                      key={value}
                      value={value}
                    >
                      {nft.collectionName} · {nft.tokenName}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[#f0c66f]">Price (ETH)</span>
            <input
              className="w-full rounded-lg border border-[#c79e54]/55 bg-[#4a2c18] px-3 py-2 text-sm text-[#fff0d0] outline-none placeholder:text-[#d5bf94] focus:border-[#e5c98c]"
              inputMode="decimal"
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder="0.10"
              type="text"
              value={priceInput}
            />
          </label>
          <ActionButton
            className={merchantPrimaryButtonClass}
            disabled={createListingMutation.isPending || nftQuery.isPending}
            onClick={() => createListingMutation.mutate()}
          >
            {createListingMutation.isPending ? "Signing order..." : "Create listing"}
          </ActionButton>
        </div>
      ) : null}

      <InlineError message={localError} />
    </MerchantFrame>
  );
}
