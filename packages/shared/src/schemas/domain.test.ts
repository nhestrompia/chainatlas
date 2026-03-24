import { describe, expect, it } from "vitest";
import { WORLD_CONFIG } from "../config/world";
import { bridgeJobSchema, merchantShopSchema, worldConfigSchema } from "./domain";

describe("shared domain schemas", () => {
  it("parses the world config", () => {
    expect(() => worldConfigSchema.parse(WORLD_CONFIG)).not.toThrow();
  });

  it("accepts valid bridge transitions payloads", () => {
    const job = bridgeJobSchema.parse({
      id: "job_1",
      address: "0x000000000000000000000000000000000000dEaD",
      sourceChain: "base",
      destinationChain: "ethereum",
      assetAddress: "native",
      amount: "0.5",
      status: "prove_required",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(job.status).toBe("prove_required");
  });

  it("accepts valid merchant shops with up to eight listings", () => {
    const now = Date.now();
    const shop = merchantShopSchema.parse({
      seller: "0x000000000000000000000000000000000000dEaD",
      chain: "ethereum",
      roomId: "ethereum:main",
      mode: "clone",
      anchor: { x: -40, y: 1.2, z: 12 },
      updatedAt: now,
      listings: Array.from({ length: 8 }, (_, index) => ({
        listingId: `listing_${index}`,
        source: "chainatlas",
        status: "active",
        seller: "0x000000000000000000000000000000000000dEaD",
        chain: "ethereum",
        nftContract: "0x000000000000000000000000000000000000bEEF",
        tokenId: String(index + 1),
        collectionName: "Collection",
        tokenName: `Item #${index + 1}`,
        priceWei: "100000000000000000",
        currencySymbol: "ETH",
        createdAt: now,
        updatedAt: now,
      })),
    });

    expect(shop.listings).toHaveLength(8);
  });

  it("rejects merchant shops with more than eight listings", () => {
    const now = Date.now();
    expect(() =>
      merchantShopSchema.parse({
        seller: "0x000000000000000000000000000000000000dEaD",
        chain: "ethereum",
        roomId: "ethereum:main",
        mode: "clone",
        anchor: { x: -40, y: 1.2, z: 12 },
        updatedAt: now,
        listings: Array.from({ length: 9 }, (_, index) => ({
          listingId: `listing_${index}`,
          source: "chainatlas",
          status: "active",
          seller: "0x000000000000000000000000000000000000dEaD",
          chain: "ethereum",
          nftContract: "0x000000000000000000000000000000000000bEEF",
          tokenId: String(index + 1),
          collectionName: "Collection",
          tokenName: `Item #${index + 1}`,
          priceWei: "100000000000000000",
          currencySymbol: "ETH",
          createdAt: now,
          updatedAt: now,
        })),
      }),
    ).toThrow();
  });
});
