import type { PredictionMarket } from "@chainatlas/shared";

const GAMMA_API_URL =
  "https://gamma-api.polymarket.com/markets?closed=false&order=volume&ascending=false&limit=3";
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;

let cachedMarkets: PredictionMarket[] | undefined;
let cachedAt = 0;

/**
 * Custom fetch wrapper that bypasses TLS verification issues in local dev
 * (e.g. corporate proxies / ISP SSL interception).
 */
async function fetchWithTlsFallback(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { signal });
  } catch (error: unknown) {
    const cause =
      error instanceof TypeError && error.cause instanceof Error
        ? error.cause
        : undefined;
    const isTlsError =
      cause?.message?.includes("unable to verify") ||
      cause?.message?.includes("UNABLE_TO_VERIFY") ||
      cause?.message?.includes("self signed");

    if (!isTlsError) {
      throw error;
    }

    console.warn(
      "[polymarket] TLS verification failed — retrying with relaxed TLS (local dev only)",
    );

    // Dynamically import node:https (not available in CF Workers)
    let httpsModule: typeof import("node:https");
    try {
      httpsModule = await import("node:https");
    } catch {
      throw error; // Re-throw original if node:https unavailable
    }

    return new Promise<Response>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = httpsModule.get(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            resolve(
              new Response(body, {
                status: res.statusCode ?? 200,
                headers: res.headers as Record<string, string>,
              }),
            );
          });
        },
      );
      signal.addEventListener("abort", () => req.destroy());
      req.on("error", reject);
    });
  }
}

interface GammaMarket {
  id: string;
  question: string;
  outcomePrices: string | string[];
  volume: string | number;
  volume24hr?: string | number;
  slug: string;
  clobTokenIds?: string | string[];
  clob_token_ids?: string | string[];
  conditionId?: string;
  condition_id?: string;
  minimum_tick_size?: string | number;
  min_tick_size?: string | number;
  tick_size?: string | number;
  negRisk?: boolean | string;
  neg_risk?: boolean | string;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item ?? "").trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      // Continue with fallback CSV parsing.
    }
    if (trimmed.includes(",")) {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }
  return [];
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function parseTickSize(value: unknown): string | undefined {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : undefined;
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return normalized;
}

function normalizeMarket(raw: GammaMarket, now: number): PredictionMarket | null {
  const prices = parseStringArray(raw.outcomePrices);

  const yesPrice = Number(prices[0]);
  const noPrice = Number(prices[1]);

  if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) {
    return null;
  }
  const tokenIds = parseStringArray(raw.clobTokenIds ?? raw.clob_token_ids);
  const conditionId = String(raw.conditionId ?? raw.condition_id ?? "").trim();
  const tickSize =
    parseTickSize(raw.minimum_tick_size) ??
    parseTickSize(raw.min_tick_size) ??
    parseTickSize(raw.tick_size);
  const negRisk = parseBoolean(raw.negRisk ?? raw.neg_risk);

  return {
    id: String(raw.id),
    question: String(raw.question),
    yesPrice,
    noPrice,
    volume: Number(raw.volume) || 0,
    slug: String(raw.slug ?? raw.id),
    conditionId: conditionId.length > 0 ? conditionId : undefined,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    tickSize,
    negRisk,
    updatedAt: now,
  };
}

export async function fetchTopPredictionMarkets(): Promise<PredictionMarket[]> {
  const now = Date.now();

  if (cachedMarkets && now - cachedAt < CACHE_TTL_MS) {
    return cachedMarkets;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchWithTlsFallback(GAMMA_API_URL, controller.signal);

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}`);
    }

    const data: GammaMarket[] = await response.json();
    const markets = data
      .map((item) => normalizeMarket(item, now))
      .filter((m): m is PredictionMarket => m !== null)
      .slice(0, 3);

    cachedMarkets = markets;
    cachedAt = now;
    return markets;
  } catch (error) {
    console.error("[polymarket] fetch error:", error instanceof Error ? error.message : error);
    if (cachedMarkets) {
      return cachedMarkets;
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
