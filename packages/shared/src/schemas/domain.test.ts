import { describe, expect, it } from "vitest";
import { WORLD_CONFIG } from "../config/world";
import { bridgeJobSchema, worldConfigSchema } from "./domain";

describe("shared domain schemas", () => {
  it("parses the world config", () => {
    expect(() => worldConfigSchema.parse(WORLD_CONFIG)).not.toThrow();
  });

  it("accepts valid bridge transitions payloads", () => {
    const job = bridgeJobSchema.parse({
      id: "job_1",
      address: "0x000000000000000000000000000000000000dEaD",
      sourceChain: "base",
      destinationChain: "ethereum",
      assetAddress: "native",
      amount: "0.5",
      status: "prove_required",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(job.status).toBe("prove_required");
  });
});
