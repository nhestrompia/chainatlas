import {
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    if (request.method !== "GET") {
      return jsonResponse(
        { message: "Method not allowed" },
        { status: 405, headers: corsHeaders },
      );
    }

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

    return jsonResponse({ message: "Not found" }, { status: 404, headers: corsHeaders });
  },
};
