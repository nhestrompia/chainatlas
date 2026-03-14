import type { BridgeJob, PortfolioAsset, ProtocolRegistryEntry } from "@cryptoworld/shared";
import { env } from "../config/env";

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
  return request<BridgeJob[]>(`/bridge-jobs/${address}`);
}

export function fetchPortfolio(address: string) {
  return request<PortfolioAsset[]>(`/portfolio/${address}`);
}

export function createBridgeJob(job: BridgeJob) {
  return request<BridgeJob>("/bridge-jobs", {
    method: "POST",
    body: JSON.stringify(job),
  });
}

export function patchBridgeJob(id: string, patch: Partial<BridgeJob>) {
  return request<BridgeJob>(`/bridge-jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
