import { Html } from "@react-three/drei";
import { useMemo } from "react";
import type { AvatarId, MerchantShop } from "@chainatlas/shared";
import { useAppStore } from "@/lib/store/app-store";
import { fetchWalletNfts } from "@/lib/api/client";
import { useQueries } from "@tanstack/react-query";
import { AvatarBody, AvatarNameTag } from "./avatar-primitives";

type RenderedShop = {
  shop: MerchantShop;
  anchor: { x: number; y: number; z: number };
  avatarId: AvatarId;
  label: string;
};

function shortAddress(address: string) {
  if (!address.startsWith("0x") || address.length < 10) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function listingNftKey(contractAddress: string, tokenId: string) {
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

function MerchantItemStrip({
  listings,
}: {
  listings: Array<{ tokenName: string; priceWei: string; imageUrl?: string }>;
}) {
  return (
    <div className="pointer-events-none rounded-md border border-[#8f7d57]/75 bg-[#141610]/95 p-1 shadow-xl">
      <div className="flex items-center gap-1">
        {Array.from({ length: 4 }, (_, slotIndex) => {
          const listing = listings[slotIndex];
          if (!listing) {
            return (
              <div
                className="size-8 rounded-sm border border-[#524a35] bg-[#0d0f0b]"
                key={`merchant-empty-slot-${slotIndex}`}
              />
            );
          }
          const listingImageUrl = resolveImageUrl(listing.imageUrl);
          return (
            <div
              className="size-8 overflow-hidden rounded-sm border border-[#a18d63] bg-[#1a1e16]"
              key={`${listing.tokenName}:${listing.priceWei}:${slotIndex}`}
            >
              {listingImageUrl ? (
                <img
                  alt={listing.tokenName}
                  className="size-full object-cover"
                  src={listingImageUrl}
                />
              ) : (
                <div className="flex size-full items-center justify-center bg-[#0f120d] text-[9px] font-semibold text-[#8f815f]">
                  NFT
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MerchantStall({ listings }: { listings: Array<{ imageUrl?: string; tokenName: string; priceWei: string }> }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
        <cylinderGeometry args={[1.05, 1.18, 0.84, 12]} />
        <meshStandardMaterial color="#4f4330" roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.88, 0]}>
        <boxGeometry args={[1.48, 0.08, 1.08]} />
        <meshStandardMaterial color="#7d1f1f" roughness={0.6} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 1.5, 0.44]}>
        <boxGeometry args={[0.9, 1.12, 0.06]} />
        <meshStandardMaterial color="#7e2323" roughness={0.58} />
      </mesh>
      <Html center position={[0, 4.55, 0]} zIndexRange={[5, 0]}>
        <MerchantItemStrip listings={listings} />
      </Html>
    </group>
  );
}

export function MerchantShops({ labelsVisible }: { labelsVisible: boolean }) {
  const session = useAppStore((state) => state.session);
  const merchantShops = useAppStore((state) => state.merchants.shops);
  const remotePresence = useAppStore((state) => state.presence.remote);
  const setOverlay = useAppStore((state) => state.setOverlay);

  const sellersNeedingImageLookup = useMemo(() => {
    const sellers = new Set<string>();
    for (const shop of Object.values(merchantShops)) {
      if (shop.roomId !== session.currentRoomId || shop.chain !== session.activeChain) {
        continue;
      }
      if (shop.listings.length === 0) {
        continue;
      }
      const hasMissingImage = shop.listings.some(
        (listing) => !resolveImageUrl(listing.imageUrl),
      );
      if (hasMissingImage) {
        sellers.add(shop.seller.toLowerCase());
      }
    }
    return [...sellers];
  }, [merchantShops, session.activeChain, session.currentRoomId]);

  const sellerNftQueries = useQueries({
    queries: sellersNeedingImageLookup.map((seller) => ({
      queryKey: ["merchant-strip-seller-nfts", seller, session.activeChain],
      queryFn: async () => {
        const imagesByToken = new Map<string, string>();
        let cursor: string | undefined;
        for (let page = 0; page < 6; page += 1) {
          const response = await fetchWalletNfts(seller, session.activeChain, cursor);
          for (const nft of response.nfts) {
            const imageUrl = resolveImageUrl(nft.imageUrl);
            if (!imageUrl) {
              continue;
            }
            imagesByToken.set(
              listingNftKey(nft.contractAddress, nft.tokenId),
              imageUrl,
            );
          }
          if (!response.nextCursor) {
            break;
          }
          cursor = response.nextCursor;
        }
        return imagesByToken;
      },
      enabled: Boolean(seller),
      staleTime: 60_000,
    })),
  });

  const listingImageBySeller = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    sellersNeedingImageLookup.forEach((seller, index) => {
      const data = sellerNftQueries[index]?.data;
      if (data) {
        map.set(seller, data);
      }
    });
    return map;
  }, [sellerNftQueries, sellersNeedingImageLookup]);

  const remotePresenceByAddress = useMemo(() => {
    const map = new Map<string, { avatarId: AvatarId; displayName: string }>();
    for (const presence of Object.values(remotePresence)) {
      map.set(presence.address.toLowerCase(), {
        avatarId: presence.avatarId,
        displayName: presence.displayName,
      });
    }
    return map;
  }, [remotePresence]);

  const renderedShops = useMemo(() => {
    return Object.values(merchantShops).flatMap<RenderedShop>((shop) => {
      if (shop.roomId !== session.currentRoomId || shop.chain !== session.activeChain) {
        return [];
      }
      if (shop.listings.length === 0) {
        return [];
      }
      const sellerAddress = shop.seller.toLowerCase();
      const remote = remotePresenceByAddress.get(sellerAddress);
      const avatarId = shop.sellerAvatarId ?? remote?.avatarId ?? "navigator";
      const label = shop.sellerDisplayName ?? remote?.displayName ?? shortAddress(shop.seller);
      const fallbackImages = listingImageBySeller.get(sellerAddress);
      const enrichedShop =
        fallbackImages && shop.listings.some((listing) => !resolveImageUrl(listing.imageUrl))
          ? {
              ...shop,
              listings: shop.listings.map((listing) => ({
                ...listing,
                imageUrl:
                  resolveImageUrl(listing.imageUrl) ??
                  fallbackImages.get(
                    listingNftKey(listing.nftContract, listing.tokenId),
                  ) ??
                  listing.imageUrl,
              })),
            }
          : shop;
      return [{ shop: enrichedShop, anchor: shop.anchor, avatarId, label }];
    });
  }, [
    listingImageBySeller,
    merchantShops,
    remotePresenceByAddress,
    session.activeChain,
    session.currentRoomId,
  ]);

  return (
    <group>
      {renderedShops.map(({ shop, anchor, avatarId, label }) => (
        <group
          key={`${shop.seller}:${shop.updatedAt}`}
          onClick={(event) => {
            event.stopPropagation();
            setOverlay("merchant", shop.seller);
          }}
          position={[anchor.x, anchor.y, anchor.z]}
        >
          <MerchantStall listings={shop.listings} />
          <group position={[0, 0.92, -0.02]}>
            <AvatarBody avatarId={avatarId} isMoving={false} />
            {labelsVisible ? <AvatarNameTag label={label} visible /> : null}
          </group>
        </group>
      ))}
    </group>
  );
}
