import { describe, expect, it } from "vitest";
import { deriveMinions } from "./minions";

describe("deriveMinions", () => {
  it("keeps all minions visible and marks supported tokens actionable", () => {
    const assets = Array.from({ length: 8 }, (_, index) => ({
      chain: "ethereum" as const,
      address: `0x${`${index}`.padStart(40, "0")}` as `0x${string}`,
      symbol: `T${index}`,
      name: `Token ${index}`,
      balance: `${10 - index}`,
      decimals: 18,
      usdValue: 1000 - index * 20,
    }));

    const result = deriveMinions(assets, new Set(["ethereum:0x0000000000000000000000000000000000000000"]));

    expect(result.minions).toHaveLength(8);
    expect(result.summary.total).toBe(8);
    expect(result.minions[0]?.actionable).toBe(true);
    expect(result.minions[0]?.name).toBe("Token 0");
    expect(result.minions[0]?.balance).toBe("10");
  });
});
