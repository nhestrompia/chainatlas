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
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as {
        message?: string;
      };
      if (typeof payload?.message === "string" && payload.message.length > 0) {
        message = `Request failed: ${response.status} (${payload.message})`;
      }
    } catch {
      // Keep default message when error body is not JSON.
    }
    throw new Error(message);
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
  tokenStandard?: "erc721" | "erc1155" | "unknown";
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

export type OpenSeaRequiredFeesResponse = {
  collection?: string;
  fees: Array<{
    recipient: string;
    basisPoints: number;
  }>;
};

export function fetchOpenSeaRequiredFees(
  chain: ChainSlug,
  nftContract: string,
  tokenId: string,
) {
  const params = new URLSearchParams({ chain });
  return request<OpenSeaRequiredFeesResponse>(
    `/market/opensea/fees/${encodeURIComponent(nftContract)}/${encodeURIComponent(tokenId)}?${params.toString()}`,
  );
}

export type OpenSeaPublishListingRequest = {
  chain: ChainSlug;
  order: {
    parameters: Record<string, unknown>;
    signature: string;
  };
};

export type OpenSeaPublishListingResponse = {
  orderHash?: string;
};

export function publishOpenSeaListing(requestBody: OpenSeaPublishListingRequest) {
  return request<OpenSeaPublishListingResponse>("/market/opensea/listings", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export type OpenSeaFulfillmentRequest = {
  chain: ChainSlug;
  orderHash: string;
  fulfiller: string;
  protocolAddress?: string;
  nftContract?: string;
  tokenId?: string;
};

export type OpenSeaFulfillmentResponse = {
  to: string;
  from?: string;
  value: string;
  data: string;
};

const OPENSEA_PROTOCOL_ADDRESS_BY_CHAIN: Record<ChainSlug, string> = {
  ethereum: "0x0000000000000068F116a894984e2DB1123eB395",
  base: "0x0000000000000068F116a894984e2DB1123eB395",
  polygon: "0x0000000000000068F116a894984e2DB1123eB395",
};

export function fetchOpenSeaFulfillment(
  requestBody: OpenSeaFulfillmentRequest,
) {
  const body: OpenSeaFulfillmentRequest = {
    ...requestBody,
    protocolAddress:
      requestBody.protocolAddress ??
      OPENSEA_PROTOCOL_ADDRESS_BY_CHAIN[requestBody.chain],
  };
  return request<OpenSeaFulfillmentResponse>("/market/opensea/fulfillment", {
    method: "POST",
    body: JSON.stringify(body),
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
