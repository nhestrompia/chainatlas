import {
  chainSlugSchema,
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
import { ZodError } from "zod";
import { createApiDataService, type ApiDataEnv } from "./data";
import { fetchTopPredictionMarkets } from "./polymarket";

type ApiResponseOptions = {
  status?: number;
  headers?: Record<string, string>;
};

function jsonResponse(payload: unknown, options: ApiResponseOptions = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: ApiDataEnv) {
    const corsHeaders = buildCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse(
        { message: "Method not allowed" },
        { status: 405, headers: corsHeaders },
      );
    }

    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const dataService = createApiDataService(env);

      if (pathname === "/health") {
        return jsonResponse({ ok: true }, { headers: corsHeaders });
      }

      if (pathname === "/protocol-registry") {
        const payload = dataService
          .listProtocolRegistry()
          .map((entry) => protocolRegistryEntrySchema.parse(entry));
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname === "/polymarket/top-markets") {
        try {
          const markets = await fetchTopPredictionMarkets({
            bypassCache: Boolean(url.searchParams.get("refresh")),
          });
          return jsonResponse(markets, { headers: corsHeaders });
        } catch (error) {
          console.error("[polymarket]", error);
          return jsonResponse(
            { message: "Failed to fetch prediction markets" },
            { status: 502, headers: corsHeaders },
          );
        }
      }

      if (pathname.startsWith("/portfolio/")) {
        const address = decodeURIComponent(pathname.slice("/portfolio/".length));
        const payload = (await dataService.listPortfolio(address)).map((asset) =>
          portfolioAssetSchema.parse(asset),
        );
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname.startsWith("/nfts/")) {
        const address = decodeURIComponent(pathname.slice("/nfts/".length));
        const chain = chainSlugSchema.parse(url.searchParams.get("chain"));
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const payload = await dataService.listWalletNfts(address, chain, cursor);
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname.startsWith("/market/opensea/listings/")) {
        const address = decodeURIComponent(
          pathname.slice("/market/opensea/listings/".length),
        );
        const chain = chainSlugSchema.parse(url.searchParams.get("chain"));
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;
        const payload = await dataService.listOpenSeaListings(address, chain, limit);
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname.startsWith("/market/opensea/fees/")) {
        const parts = pathname
          .slice("/market/opensea/fees/".length)
          .split("/")
          .filter(Boolean);
        const [contract, tokenId] = parts;
        if (!contract || !tokenId) {
          return jsonResponse(
            { message: "Invalid request parameters" },
            { status: 400, headers: corsHeaders },
          );
        }
        const chain = chainSlugSchema.parse(url.searchParams.get("chain"));
        const payload = await dataService.getOpenSeaRequiredFees({
          chain,
          nftContract: decodeURIComponent(contract),
          tokenId: decodeURIComponent(tokenId),
        });
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname === "/market/opensea/listings" && request.method === "POST") {
        const rawBody = (await request.json()) as unknown;
        const body =
          rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
        const chain = chainSlugSchema.parse(body.chain);
        const order =
          body.order && typeof body.order === "object"
            ? (body.order as Record<string, unknown>)
            : {};
        const parameters =
          order.parameters && typeof order.parameters === "object"
            ? (order.parameters as Record<string, unknown>)
            : {};
        const signature = typeof order.signature === "string" ? order.signature : "";
        const payload = await dataService.createOpenSeaListing({
          chain,
          order: {
            parameters,
            signature,
          },
        });
        return jsonResponse(payload, { headers: corsHeaders });
      }

      if (pathname === "/market/opensea/fulfillment" && request.method === "POST") {
        const rawBody = (await request.json()) as unknown;
        const body =
          rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
        const chain = chainSlugSchema.parse(body.chain);
        const orderHash =
          typeof body.orderHash === "string" ? body.orderHash : "";
        const fulfiller =
          typeof body.fulfiller === "string" ? body.fulfiller : "";
        const protocolAddress =
          typeof body.protocolAddress === "string" ? body.protocolAddress : undefined;
        const nftContract =
          typeof body.nftContract === "string" ? body.nftContract : undefined;
        const tokenId =
          typeof body.tokenId === "string" ? body.tokenId : undefined;
        const payload = await dataService.buildOpenSeaFulfillment({
          chain,
          orderHash,
          fulfiller,
          protocolAddress,
          nftContract,
          tokenId,
        });
        return jsonResponse(payload, { headers: corsHeaders });
      }

      return jsonResponse({ message: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (error) {
      if (error instanceof ZodError) {
        return jsonResponse(
          { message: "Invalid request parameters", issues: error.issues },
          { status: 400, headers: corsHeaders },
        );
      }
      if (error instanceof Error) {
        const statusMatch = error.message.match(
          /OpenSea request failed \((\d{3})\)/,
        );
        const status =
          statusMatch && statusMatch[1]
            ? Number.parseInt(statusMatch[1], 10)
            : 500;
        return jsonResponse(
          { message: error.message || "Internal server error" },
          { status, headers: corsHeaders },
        );
      }
      console.error("[api]", error);
      return jsonResponse(
        { message: "Internal server error" },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
