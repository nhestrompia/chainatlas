import { describe, expect, it } from "vitest";
import { getRuntimeProtocolConfig } from "@cryptoworld/shared";
import { getSwapRoutesForChain, resolveSwapRoute } from "./protocol-registry";

describe("protocol registry helpers", () => {
  const registry = getRuntimeProtocolConfig("testnet").protocolRegistry;

  it("returns swap routes for a chain", () => {
    const ethereumRoutes = getSwapRoutesForChain(registry, "ethereum");
    expect(ethereumRoutes.length).toBeGreaterThan(0);
    expect(ethereumRoutes[0]?.chain).toBe("ethereum");
  });

  it("resolves a route id and throws on unknown route", () => {
    const route = resolveSwapRoute(registry, "swap-eth-usdc-ethereum");
    expect(route.routeId).toBe("swap-eth-usdc-ethereum");

    expect(() => resolveSwapRoute(registry, "does-not-exist")).toThrow();
  });
});

