import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";

type RenderedShop = {
  shop: {
    seller: string;
    updatedAt: number;
    mode: "clone" | "mobile";
    listings: Array<{ tokenName: string; priceWei: string; imageUrl?: string }>;
  };
  anchor: { x: number; y: number; z: number };
  mobile: boolean;
};

function MerchantBoard({
  label,
  listings,
}: {
  label: string;
  listings: Array<{ tokenName: string; priceWei: string; imageUrl?: string }>;
}) {
  return (
    <div className="pointer-events-none min-w-[210px] rounded-xl border border-amber-200/35 bg-[#2b1e12]/92 px-3 py-2 text-amber-50 shadow-xl">
      <p className="text-[11px] font-semibold text-amber-100/85">{label}</p>
      <p className="text-[10px] text-amber-200/80">{listings.length} listings</p>
      <div className="mt-2 space-y-1.5">
        {listings.slice(0, 3).map((listing) => (
          <div
            key={`${listing.tokenName}:${listing.priceWei}`}
            className="flex items-center gap-2 rounded-md border border-amber-200/20 bg-[#3b2a19]/85 px-2 py-1"
          >
            <div className="size-8 overflow-hidden rounded border border-amber-200/20 bg-[#4a3522]">
              {listing.imageUrl ? (
                <img
                  alt={listing.tokenName}
                  className="size-full object-cover"
                  src={listing.imageUrl}
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-amber-50">{listing.tokenName}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MerchantShops({ labelsVisible }: { labelsVisible: boolean }) {
  const session = useAppStore((state) => state.session);
  const merchantShops = useAppStore((state) => state.merchants.shops);
  const remote = useAppStore((state) => state.presence.remote);
  const localPresence = useAppStore((state) => state.presence.local);
  const setOverlay = useAppStore((state) => state.setOverlay);

  const renderedShops = useMemo(() => {
    return Object.values(merchantShops).flatMap<RenderedShop>((shop) => {
      if (shop.roomId !== session.currentRoomId || shop.chain !== session.activeChain) {
        return [];
      }
      if (shop.listings.length === 0) {
        return [];
      }
      if (shop.mode === "mobile") {
        const sellerLower = shop.seller.toLowerCase();
        const anchor =
          session.connectedAddress?.toLowerCase() === sellerLower
            ? localPresence?.position
            : Object.values(remote).find(
                (presence) => presence.address.toLowerCase() === sellerLower,
              )?.position;
        if (!anchor) {
          return [];
        }
        return [{ shop, anchor, mobile: true }];
      }
      return [{ shop, anchor: shop.anchor, mobile: false }];
    });
  }, [
    localPresence?.position,
    merchantShops,
    remote,
    session.activeChain,
    session.connectedAddress,
    session.currentRoomId,
  ]);

  return (
    <group>
      {renderedShops.map(({ shop, anchor, mobile }) => (
        <group
          key={`${shop.seller}:${shop.updatedAt}:${shop.mode}`}
          onClick={(event) => {
            event.stopPropagation();
            setOverlay("merchant", shop.seller);
          }}
          position={[anchor.x, anchor.y, anchor.z]}
        >
          {!mobile ? (
            <>
              <mesh castShadow receiveShadow position={[0, 0.45, 0]}>
                <cylinderGeometry args={[1.4, 1.6, 0.9, 16]} />
                <meshStandardMaterial color="#6d4c2f" roughness={0.8} />
              </mesh>
              <mesh castShadow position={[0, 1.45, 0]}>
                <boxGeometry args={[1.8, 1.2, 1.1]} />
                <meshStandardMaterial color="#8a5f37" roughness={0.7} />
              </mesh>
            </>
          ) : null}
          {labelsVisible ? (
            <Html center position={[0, mobile ? 3 : 3.2, 0]}>
              <div className="text-center">
                <div className="mx-auto w-max rounded-md border border-amber-200/35 bg-[#22180f]/90 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                  {mobile ? "SELLING" : "SHOP OPEN"}
                </div>
                <div className="mt-1">
                  <MerchantBoard
                    label={mobile ? "Mobile Merchant" : "Merchant Stall"}
                    listings={shop.listings}
                  />
                </div>
              </div>
            </Html>
          ) : null}
        </group>
      ))}
    </group>
  );
}
