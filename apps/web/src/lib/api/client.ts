import type { BridgeJob, PredictionMarket, PortfolioAsset, ProtocolRegistryEntry } from "@chainatlas/shared";
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
