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
  outcomePrices: string;
  volume: string | number;
  volume24hr?: string | number;
  slug: string;
}

function normalizeMarket(raw: GammaMarket, now: number): PredictionMarket | null {
  let prices: unknown[];
  try {
    prices = JSON.parse(raw.outcomePrices);
  } catch {
    return null;
  }

  const yesPrice = Number(prices[0]);
  const noPrice = Number(prices[1]);

  if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) {
    return null;
  }

  return {
    id: String(raw.id),
    question: String(raw.question),
    yesPrice,
    noPrice,
    volume: Number(raw.volume) || 0,
    slug: String(raw.slug ?? raw.id),
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
