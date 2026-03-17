import { beforeEach, describe, expect, it } from "vitest";
import type { MerchantShop } from "@chainatlas/shared";
import { useAppStore } from "./app-store";

const baseShop: MerchantShop = {
  seller: "0x000000000000000000000000000000000000dEaD",
  chain: "ethereum",
  roomId: "ethereum:main",
  mode: "clone",
  anchor: { x: -10, y: 1.2, z: 4 },
  updatedAt: Date.now(),
  listings: [
    {
      listingId: "listing_1",
      source: "chainatlas",
      status: "active",
      seller: "0x000000000000000000000000000000000000dEaD",
      chain: "ethereum",
      nftContract: "0x000000000000000000000000000000000000bEEF",
      tokenId: "1",
      collectionName: "Collection",
      tokenName: "NFT #1",
      priceWei: "100000000000000000",
      currencySymbol: "ETH",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
};

describe("app-store merchant slice", () => {
  beforeEach(() => {
    useAppStore.setState({
      merchants: { shops: {} },
      overlays: {},
    });
  });

  it("hydrates and upserts merchant shops", () => {
    useAppStore.getState().hydrateMerchants([baseShop]);
    expect(
      useAppStore.getState().merchants.shops[baseShop.seller.toLowerCase()]?.listings.length,
    ).toBe(1);

    useAppStore.getState().upsertMerchantShop({
      ...baseShop,
      listings: [...baseShop.listings, { ...baseShop.listings[0], listingId: "listing_2" }],
    });
    expect(
      useAppStore.getState().merchants.shops[baseShop.seller.toLowerCase()]?.listings.length,
    ).toBe(2);
  });

  it("removes listings and prunes empty shops", () => {
    useAppStore.getState().hydrateMerchants([baseShop]);
    useAppStore.getState().removeMerchantListing(baseShop.seller, "listing_1");
    expect(useAppStore.getState().merchants.shops[baseShop.seller.toLowerCase()]).toBeUndefined();
  });
});
