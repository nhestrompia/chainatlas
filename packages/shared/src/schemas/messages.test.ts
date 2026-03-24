import { describe, expect, it } from "vitest";
import { clientMessageSchema, serverMessageSchema } from "./messages";

const now = Date.now();
const sampleShop = {
  seller: "0x000000000000000000000000000000000000dEaD",
  chain: "ethereum",
  roomId: "ethereum:main",
  mode: "clone",
  anchor: { x: -42, y: 1.2, z: 8 },
  updatedAt: now,
  listings: [
    {
      listingId: "listing_1",
      source: "opensea",
      status: "active",
      seller: "0x000000000000000000000000000000000000dEaD",
      chain: "ethereum",
      nftContract: "0x000000000000000000000000000000000000bEEF",
      tokenId: "42",
      collectionName: "Sample Collection",
      tokenName: "Sample #42",
      priceWei: "100000000000000000",
      currencySymbol: "ETH",
      createdAt: now,
      updatedAt: now,
    },
  ],
} as const;

describe("shared messages schemas", () => {
  it("parses merchant client messages", () => {
    expect(() =>
      clientMessageSchema.parse({
        type: "merchant:upsert-shop",
        payload: { shop: sampleShop },
      }),
    ).not.toThrow();
    expect(() =>
      clientMessageSchema.parse({
        type: "merchant:cancel-listing",
        payload: { seller: sampleShop.seller, listingId: "listing_1" },
      }),
    ).not.toThrow();
  });

  it("parses merchant server messages", () => {
    expect(() =>
      serverMessageSchema.parse({
        type: "merchant:snapshot",
        payload: { shops: [sampleShop] },
      }),
    ).not.toThrow();
    expect(() =>
      serverMessageSchema.parse({
        type: "merchant:listing-removed",
        payload: { seller: sampleShop.seller, listingId: "listing_1" },
      }),
    ).not.toThrow();
  });
});
