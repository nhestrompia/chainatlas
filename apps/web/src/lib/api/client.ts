import type {
  BridgeJob,
  ChainSlug,
  MerchantListing,
  PortfolioAsset,
  PredictionMarket,
  ProtocolRegistryEntry,
} from "@chainatlas/shared";
import { env } from "../config/env";
import { browserBridgeJobStore } from "../storage/bridge-job-store";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function fetchProtocolRegistry() {
  return request<ProtocolRegistryEntry[]>("/protocol-registry");
}

export function fetchBridgeJobs(address: string) {
  return browserBridgeJobStore.getJobs(address);
}

export function fetchPortfolio(address: string) {
  return request<PortfolioAsset[]>(`/portfolio/${address}`);
}

export type WalletNft = {
  contractAddress: string;
  tokenId: string;
  collectionName: string;
  tokenName: string;
  imageUrl?: string;
};

export type WalletNftsResponse = {
  nfts: WalletNft[];
  nextCursor?: string;
};

export function fetchWalletNfts(
  address: string,
  chain: ChainSlug,
  cursor?: string,
) {
  const params = new URLSearchParams({ chain });
  if (cursor) {
    params.set("cursor", cursor);
  }
  return request<WalletNftsResponse>(`/nfts/${address}?${params.toString()}`);
}

export function fetchOpenSeaListings(
  address: string,
  chain: ChainSlug,
  limit = 20,
) {
  const params = new URLSearchParams({
    chain,
    limit: String(limit),
  });
  return request<{ listings: MerchantListing[] }>(
    `/market/opensea/listings/${address}?${params.toString()}`,
  );
}

export type OpenSeaFulfillmentRequest = {
  chain: ChainSlug;
  orderHash: string;
  fulfiller: string;
  protocolAddress?: string;
};

export type OpenSeaFulfillmentResponse = {
  to: string;
  from?: string;
  value: string;
  data: string;
};

export function fetchOpenSeaFulfillment(
  requestBody: OpenSeaFulfillmentRequest,
) {
  return request<OpenSeaFulfillmentResponse>("/market/opensea/fulfillment", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export function createBridgeJob(job: BridgeJob) {
  return browserBridgeJobStore.upsertJob(job);
}

export function patchBridgeJob(id: string, patch: Partial<BridgeJob>) {
  return browserBridgeJobStore.patchJob(id, patch);
}

export function fetchPredictionMarkets(refreshKey?: string) {
  const query =
    typeof refreshKey === "string" && refreshKey.length > 0
      ? `?refresh=${encodeURIComponent(refreshKey)}`
      : "";
  return request<PredictionMarket[]>(`/polymarket/top-markets${query}`);
}
