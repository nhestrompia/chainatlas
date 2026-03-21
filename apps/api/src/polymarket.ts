import type { PredictionMarket } from "@chainatlas/shared";

const GAMMA_FETCH_LIMIT = 200;
const GAMMA_API_URL =
  `https://gamma-api.polymarket.com/markets?closed=false&order=volume&ascending=false&limit=${GAMMA_FETCH_LIMIT}`;
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const DISPLAY_MARKET_COUNT = 3;
const ROTATION_POOL_SIZE = 20;
const MIN_MARKET_VOLUME_USD = 500_000;
const MIN_TIME_TO_CLOSE_MS = 60 * 60 * 1000;

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
  outcomes?: string | string[];
  outcome_names?: string | string[];
  outcomeNames?: string | string[];
  outcome_labels?: string | string[];
  outcomeLabels?: string | string[];
  outcomePrices: string | string[];
  volume: string | number;
  volume24hr?: string | number;
  volume_num?: string | number;
  liquidity?: string | number;
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
  endDate?: string | number;
  end_date?: string | number;
  endDateIso?: string;
  end_date_iso?: string;
  closeDate?: string | number;
  close_date?: string | number;
  resolutionDate?: string | number;
  resolution_date?: string | number;
}

function normalizeOutcomeLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function resolveYesNoIndexes(raw: GammaMarket) {
  const labels = parseStringArray(
    raw.outcomes ??
      raw.outcomeNames ??
      raw.outcome_names ??
      raw.outcomeLabels ??
      raw.outcome_labels,
  );
  if (labels.length !== 2) {
    return null;
  }

  const normalized = labels.map((label) => normalizeOutcomeLabel(label));
  const yesIndex = normalized.findIndex((label) => label === "yes");
  const noIndex = normalized.findIndex((label) => label === "no");
  if (yesIndex < 0 || noIndex < 0) {
    return null;
  }

  return { noIndex, yesIndex };
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

function parseVolume(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function selectRandomMarkets(pool: PredictionMarket[], count: number) {
  if (pool.length <= count) {
    return pool;
  }

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, count);
}

function parseDateMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return undefined;
    }
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveCloseTimestampMs(raw: GammaMarket): number | undefined {
  return (
    parseDateMs(raw.endDateIso) ??
    parseDateMs(raw.end_date_iso) ??
    parseDateMs(raw.endDate) ??
    parseDateMs(raw.end_date) ??
    parseDateMs(raw.closeDate) ??
    parseDateMs(raw.close_date) ??
    parseDateMs(raw.resolutionDate) ??
    parseDateMs(raw.resolution_date)
  );
}

function normalizeMarket(raw: GammaMarket, now: number): PredictionMarket | null {
  const indexes = resolveYesNoIndexes(raw);
  if (!indexes) {
    return null;
  }

  const prices = parseStringArray(raw.outcomePrices);
  const yesPrice = Number(prices[indexes.yesIndex]);
  const noPrice = Number(prices[indexes.noIndex]);

  if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) {
    return null;
  }
  const tokenIds = parseStringArray(raw.clobTokenIds ?? raw.clob_token_ids);
  const yesTokenId = tokenIds[indexes.yesIndex];
  const noTokenId = tokenIds[indexes.noIndex];
  if (!yesTokenId || !noTokenId) {
    return null;
  }
  const conditionId = String(raw.conditionId ?? raw.condition_id ?? "").trim();
  const tickSize =
    parseTickSize(raw.minimum_tick_size) ??
    parseTickSize(raw.min_tick_size) ??
    parseTickSize(raw.tick_size);
  const negRisk = parseBoolean(raw.negRisk ?? raw.neg_risk);
  const closeTimestampMs = resolveCloseTimestampMs(raw);
  if (
    typeof closeTimestampMs === "number" &&
    closeTimestampMs - now < MIN_TIME_TO_CLOSE_MS
  ) {
    return null;
  }
  const volume = Math.max(
    parseVolume(raw.volume),
    parseVolume(raw.volume24hr),
    parseVolume(raw.volume_num),
  );
  if (volume < MIN_MARKET_VOLUME_USD) {
    return null;
  }

  return {
    id: String(raw.id),
    question: String(raw.question),
    yesPrice,
    noPrice,
    volume,
    slug: String(raw.slug ?? raw.id),
    conditionId: conditionId.length > 0 ? conditionId : undefined,
    yesTokenId,
    noTokenId,
    tickSize,
    negRisk,
    updatedAt: now,
  };
}

export async function fetchTopPredictionMarkets(options?: {
  bypassCache?: boolean;
}): Promise<PredictionMarket[]> {
  const now = Date.now();

  if (!options?.bypassCache && cachedMarkets && now - cachedAt < CACHE_TTL_MS) {
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
    const normalizedMarkets = data
      .map((item) => normalizeMarket(item, now))
      .filter((m): m is PredictionMarket => m !== null);
    const topByVolumePool = normalizedMarkets
      .sort((a, b) => b.volume - a.volume)
      .slice(0, ROTATION_POOL_SIZE);
    const selectedMarkets = selectRandomMarkets(
      topByVolumePool,
      DISPLAY_MARKET_COUNT,
    );

    cachedMarkets = selectedMarkets;
    cachedAt = now;
    return selectedMarkets;
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
