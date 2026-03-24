import { describe, expect, it } from "vitest";
import { createApiDataService, listProtocolRegistry } from "./data";

describe("api data adapters", () => {
  it("returns the protocol registry", () => {
    expect(listProtocolRegistry().length).toBeGreaterThan(0);
  });

  it("returns empty OpenSea listings when API key is missing", async () => {
    const service = createApiDataService({});
    const result = await service.listOpenSeaListings(
      "0x000000000000000000000000000000000000dEaD",
      "ethereum",
    );
    expect(result.listings).toHaveLength(0);
  });

  it("returns empty OpenSea listings when OpenSea rate-limits the request", async () => {
    let requestCount = 0;
    const fetchMock = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orders/ethereum/seaport/listings")) {
        requestCount += 1;
        return new Response(JSON.stringify({ errors: ["Rate limit exceeded"] }), { status: 429 });
      }
      if (url.includes("/events/accounts/")) {
        requestCount += 1;
        return new Response("unexpected fallback call", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const service = createApiDataService({ OPENSEA_API_KEY: "test-key" });
      const result = await service.listOpenSeaListings(
        "0x000000000000000000000000000000000000dEaD",
        "ethereum",
      );
      expect(result.listings).toHaveLength(0);
      expect(requestCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses OpenSea listings payloads and fulfillment transaction call data", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/orders/ethereum/seaport/listings")) {
        return new Response(
          JSON.stringify({
            orders: [
              {
                order_hash:
                  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                maker: { address: "0x000000000000000000000000000000000000dEaD" },
                protocol_data: {
                  parameters: {
                    offer: [
                      {
                        itemType: 2,
                        token: "0x000000000000000000000000000000000000bEEF",
                        identifierOrCriteria: "42",
                      },
                    ],
                    consideration: [{ itemType: 0, startAmount: "100000000000000000" }],
                    endTime: `${Math.floor(Date.now() / 1000) + 3_600}`,
                  },
                },
                collection: { name: "Collection" },
                image_url: "https://example.com/image.png",
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            fulfillment_data: {
              transaction: {
                to: "0x0000000000000000000000000000000000001234",
                value: "0",
                data: "0xabcdef",
              },
            },
          }),
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const service = createApiDataService({ OPENSEA_API_KEY: "test-key" });
      const listings = await service.listOpenSeaListings(
        "0x000000000000000000000000000000000000dEaD",
        "ethereum",
      );
      expect(listings.listings).toHaveLength(1);
      expect(listings.listings[0]?.source).toBe("opensea");

      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: "0x000000000000000000000000000000000000dEaD",
      });
      expect(fulfillment.to).toBe("0x0000000000000000000000000000000000001234");
      expect(fulfillment.data).toBe("0xabcdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
