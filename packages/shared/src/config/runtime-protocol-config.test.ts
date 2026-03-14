import { describe, expect, it } from "vitest";
import { getRuntimeProtocolConfig, resolveRuntimeProfile } from "./runtime-protocol-config";

describe("runtime protocol config", () => {
  it("defaults to testnet profile", () => {
    expect(resolveRuntimeProfile(undefined)).toBe("testnet");
    expect(resolveRuntimeProfile("unknown")).toBe("testnet");
  });

  it("returns profile-aware chain ids and routes", () => {
    const config = getRuntimeProtocolConfig("mainnet");
    expect(config.profile).toBe("mainnet");
    expect(config.chains.ethereum.chainId).toBe(1);
    expect(config.chains.base.chainId).toBe(8453);
    expect(config.swapRoutes.length).toBeGreaterThan(0);
  });
});

