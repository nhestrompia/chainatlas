import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let dataModule: typeof import("./data");

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chainatlas-api-"));
  process.env.BRIDGE_JOB_STORE_PATH = path.join(dir, "bridge-jobs.json");
  vi.resetModules();
  dataModule = await import("./data");
});

describe("api data adapters", () => {
  it("persists bridge jobs to disk", async () => {
    const job = await dataModule.upsertBridgeJob({
      id: "job-1",
      address: "0x0000000000000000000000000000000000000001",
      sourceChain: "ethereum",
      destinationChain: "base",
      assetAddress: "native",
      amount: "1",
      status: "submitted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(job.id).toBe("job-1");
    const raw = await readFile(process.env.BRIDGE_JOB_STORE_PATH!, "utf8");
    expect(raw).toContain("job-1");
    expect(await dataModule.listBridgeJobs("0x0000000000000000000000000000000000000001")).toHaveLength(1);
  });

  it("returns the protocol registry", () => {
    expect(dataModule.listProtocolRegistry().length).toBeGreaterThan(0);
  });
});
