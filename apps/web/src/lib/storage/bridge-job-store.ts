import { bridgeJobSchema, type BridgeJob } from "@chainatlas/shared";

const STORAGE_PREFIX = "chainatlas:bridge-jobs:";

export interface BridgeJobStore {
  getJobs(address: string): Promise<BridgeJob[]>;
  upsertJob(job: BridgeJob): Promise<BridgeJob>;
  patchJob(id: string, patch: Partial<BridgeJob>): Promise<BridgeJob>;
}

const memoryStore = new Map<string, string>();

function supportsBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStorageItem(key: string) {
  if (supportsBrowserStorage()) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Fall back to in-memory storage when localStorage is unavailable.
    }
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string) {
  if (supportsBrowserStorage()) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      // Fall back to in-memory storage when localStorage is unavailable.
    }
  }
  memoryStore.set(key, value);
}

function storageKeys() {
  const keys = new Set<string>();
  if (supportsBrowserStorage()) {
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keys.add(key);
        }
      }
    } catch {
      // Ignore browser storage errors and continue with in-memory keys.
    }
  }
  for (const key of memoryStore.keys()) {
    if (key.startsWith(STORAGE_PREFIX)) {
      keys.add(key);
    }
  }
  return [...keys];
}

function keyForAddress(address: string) {
  return `${STORAGE_PREFIX}${address.toLowerCase()}`;
}

function parseJobs(raw: string | null) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      const job = bridgeJobSchema.safeParse(entry);
      return job.success ? [job.data as BridgeJob] : [];
    });
  } catch {
    return [];
  }
}

function readJobsByKey(storageKey: string) {
  return parseJobs(getStorageItem(storageKey));
}

function writeJobsByKey(storageKey: string, jobs: BridgeJob[]) {
  setStorageItem(storageKey, JSON.stringify(jobs));
}

function upsertInList(jobs: BridgeJob[], job: BridgeJob) {
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    const next = [...jobs];
    next[index] = job;
    return next;
  }
  return [job, ...jobs];
}

function mergePatchedJob(job: BridgeJob, patch: Partial<BridgeJob>) {
  const next = {
    ...job,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  return bridgeJobSchema.parse(next) as BridgeJob;
}

class BrowserBridgeJobStore implements BridgeJobStore {
  async getJobs(address: string): Promise<BridgeJob[]> {
    return readJobsByKey(keyForAddress(address));
  }

  async upsertJob(job: BridgeJob): Promise<BridgeJob> {
    const parsedJob = bridgeJobSchema.parse(job) as BridgeJob;
    const storageKey = keyForAddress(parsedJob.address);
    const jobs = readJobsByKey(storageKey);
    writeJobsByKey(storageKey, upsertInList(jobs, parsedJob));
    return parsedJob;
  }

  async patchJob(id: string, patch: Partial<BridgeJob>): Promise<BridgeJob> {
    for (const storageKey of storageKeys()) {
      const jobs = readJobsByKey(storageKey);
      const index = jobs.findIndex((job) => job.id === id);
      if (index < 0) {
        continue;
      }

      const nextJob = mergePatchedJob(jobs[index]!, patch);
      const nextJobs = [...jobs];
      nextJobs[index] = nextJob;
      writeJobsByKey(storageKey, nextJobs);
      return nextJob;
    }

    throw new Error("Bridge job not found");
  }
}

export const browserBridgeJobStore: BridgeJobStore = new BrowserBridgeJobStore();
