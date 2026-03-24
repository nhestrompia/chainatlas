import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
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
    let capturedFulfillmentBody: unknown;
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
                  signature:
                    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  parameters: {
                    offer: [
                      {
                        itemType: 2,
                        token: "0x000000000000000000000000000000000000bEEF",
                        identifierOrCriteria: "42",
                      },
                    ],
                    consideration: [
                      { itemType: 0, startAmount: "94000000000000000" },
                      { itemType: 0, startAmount: "6000000000000000" },
                    ],
                    endTime: `${Math.floor(Date.now() / 1000) + 3_600}`,
                  },
                },
                price: { value: "100000000000000000" },
                collection: { name: "Collection" },
                image_url: "https://example.com/image.png",
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        capturedFulfillmentBody = init.body
          ? JSON.parse(String(init.body))
          : undefined;
        return new Response(
          JSON.stringify({
            fulfillment_data: {
              transaction: {
                to: "0x0000000000000000000000000000000000001234",
                value: "0",
                input_data: "0xabcdef",
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
      expect(listings.listings[0]?.priceWei).toBe("100000000000000000");
      expect(
        (
          listings.listings[0]?.seaportOrder as
            | { parameters?: Record<string, unknown>; signature?: string }
            | undefined
        )?.signature,
      ).toBe(
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      );

      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: "0x000000000000000000000000000000000000dEaD",
      });
      expect(
        (capturedFulfillmentBody as { listing?: { protocol_address?: string } })
          ?.listing?.protocol_address,
      ).toBe("0x0000000000000068F116a894984e2DB1123eB395");
      expect(fulfillment.to).toBe("0x0000000000000000000000000000000000001234");
      expect(fulfillment.data).toBe("0xabcdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sums native consideration for gross listing price when OpenSea item types are strings", async () => {
    const fetchMock = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orders/ethereum/seaport/listings")) {
        return new Response(
          JSON.stringify({
            orders: [
              {
                order_hash:
                  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                maker: { address: "0x000000000000000000000000000000000000dEaD" },
                protocol_data: {
                  parameters: {
                    offer: [
                      {
                        itemType: "ERC721",
                        token: "0x000000000000000000000000000000000000bEEF",
                        identifierOrCriteria: "777",
                      },
                    ],
                    consideration: [
                      { itemType: "NATIVE", startAmount: "94000000000000000" },
                      { itemType: "NATIVE", startAmount: "6000000000000000" },
                    ],
                    endTime: `${Math.floor(Date.now() / 1000) + 3_600}`,
                  },
                },
                collection: { name: "Collection" },
              },
            ],
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
      expect(listings.listings[0]?.priceWei).toBe("100000000000000000");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("encodes OpenSea structured fulfillment input_data and forwards listing consideration", async () => {
    let capturedFulfillmentBody: unknown;
    const callTarget = "0x000000000000000000000000000000000000bEEF";
    const buyerAddress = "0x000000000000000000000000000000000000dEaD";
    const assetContract = "0x0000000000000000000000000000000000001234";
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        capturedFulfillmentBody = init.body
          ? JSON.parse(String(init.body))
          : undefined;
        return new Response(
          JSON.stringify({
            fulfillment_data: {
              transaction: {
                function: "transfer(address to,uint256 amount)",
                to: callTarget,
                value: "0",
                input_data: {
                  parameters: {
                    to: buyerAddress,
                    amount: "42",
                  },
                },
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
      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: buyerAddress,
        nftContract: assetContract,
        tokenId: "42",
      });
      expect(
        (capturedFulfillmentBody as { consideration?: { asset_contract_address?: string } })
          ?.consideration?.asset_contract_address,
      ).toBe(assetContract);
      expect(
        (capturedFulfillmentBody as { consideration?: { token_id?: string } })
          ?.consideration?.token_id,
      ).toBe("42");
      const iface = new Interface([
        "function transfer(address to,uint256 amount)",
      ]);
      const expectedData = iface.encodeFunctionData("transfer", [
        buyerAddress,
        "42",
      ]);
      expect(fulfillment.to).toBe(callTarget.toLowerCase());
      expect(fulfillment.data).toBe(expectedData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses nested OpenSea fulfillment transaction payloads with typed value arrays", async () => {
    const callTarget = "0x000000000000000000000000000000000000bEEF";
    const buyerAddress = "0x000000000000000000000000000000000000dEaD";
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            fulfillment_data: {
              fulfillment_data: {
                transaction: {
                  function: "transfer(address to,uint256 amount)",
                  to: callTarget,
                  value: "0x0",
                  input_data: {
                    value: [
                      { typeAsString: "address", value: buyerAddress },
                      { typeAsString: "uint256", value: "42" },
                    ],
                  },
                },
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
      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: buyerAddress,
      });
      const iface = new Interface([
        "function transfer(address to,uint256 amount)",
      ]);
      const expectedData = iface.encodeFunctionData("transfer", [
        buyerAddress,
        "42",
      ]);
      expect(fulfillment.to).toBe(callTarget.toLowerCase());
      expect(fulfillment.value).toBe("0x0");
      expect(fulfillment.data).toBe(expectedData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts fulfillment calldata from deeply nested input_data payload", async () => {
    const callTarget = "0x000000000000000000000000000000000000bEEF";
    const buyerAddress = "0x000000000000000000000000000000000000dEaD";
    const iface = new Interface([
      "function transfer(address to,uint256 amount)",
    ]);
    const expectedData = iface.encodeFunctionData("transfer", [
      buyerAddress,
      "42",
    ]);
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            fulfillment_data: {
              transaction: {
                to: {
                  typeAsString: "address",
                  value: callTarget,
                },
                value: {
                  typeAsString: "uint256",
                  value: "0x0",
                },
                input_data: {
                  payload: {
                    call_data: expectedData,
                  },
                },
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
      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: buyerAddress,
      });
      expect(fulfillment.to).toBe(callTarget.toLowerCase());
      expect(fulfillment.value).toBe("0x0");
      expect(fulfillment.data).toBe(expectedData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts fulfillment calldata when input_data is a typed bytes wrapper", async () => {
    const callTarget = "0x000000000000000000000000000000000000bEEF";
    const buyerAddress = "0x000000000000000000000000000000000000dEaD";
    const expectedData =
      "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead000000000000000000000000000000000000000000000000000000000000002a";
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            protocol: "seaport",
            fulfillment_data: {
              transaction: {
                function: "transfer(address to,uint256 amount)",
                chain: 1,
                to: callTarget,
                value: {
                  typeAsString: "uint256",
                  value: "0x0",
                },
                input_data: {
                  typeAsString: "bytes",
                  value: expectedData,
                },
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
      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: buyerAddress,
      });
      expect(fulfillment.to).toBe(callTarget.toLowerCase());
      expect(fulfillment.value).toBe("0x0");
      expect(fulfillment.data).toBe(expectedData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts fulfillment calldata from single-item typed input_data array", async () => {
    const callTarget = "0x000000000000000000000000000000000000bEEF";
    const buyerAddress = "0x000000000000000000000000000000000000dEaD";
    const expectedData =
      "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead000000000000000000000000000000000000000000000000000000000000002a";
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/listings/fulfillment_data") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            protocol: "seaport",
            fulfillment_data: {
              transaction: {
                function: "transfer(address to,uint256 amount)",
                chain: 1,
                to: callTarget,
                value: "0x0",
                input_data: [{ typeAsString: "bytes", value: expectedData }],
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
      const fulfillment = await service.buildOpenSeaFulfillment({
        chain: "ethereum",
        orderHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fulfiller: buyerAddress,
      });
      expect(fulfillment.to).toBe(callTarget.toLowerCase());
      expect(fulfillment.value).toBe("0x0");
      expect(fulfillment.data).toBe(expectedData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("submits OpenSea listing orders", async () => {
    let capturedBody: unknown;
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/orders/ethereum/seaport/listings") && init?.method === "POST") {
        capturedBody = init.body ? JSON.parse(String(init.body)) : undefined;
        return new Response(
          JSON.stringify({
            order_hash:
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const service = createApiDataService({
        OPENSEA_API_KEY: "test-key",
        CRYPTO_WORLD_PROFILE: "mainnet",
      });
      const response = await service.createOpenSeaListing({
        chain: "ethereum",
        order: {
          parameters: {
            offerer: "0x000000000000000000000000000000000000dEaD",
          },
          signature:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      });
      expect(
        (capturedBody as { parameters?: { offerer?: string } } | undefined)
          ?.parameters?.offerer,
      ).toBe("0x000000000000000000000000000000000000dEaD");
      expect(
        (capturedBody as { signature?: string } | undefined)?.signature,
      ).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(
        (capturedBody as { protocol_address?: string } | undefined)
          ?.protocol_address,
      ).toBe("0x0000000000000068F116a894984e2DB1123eB395");
      expect(response.orderHash).toBe(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects OpenSea listing publish outside mainnet profile", async () => {
    const service = createApiDataService({
      OPENSEA_API_KEY: "test-key",
      CRYPTO_WORLD_PROFILE: "testnet",
    });
    await expect(
      service.createOpenSeaListing({
        chain: "ethereum",
        order: {
          parameters: {},
          signature:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    ).rejects.toThrow("mainnet profile");
  });
});
