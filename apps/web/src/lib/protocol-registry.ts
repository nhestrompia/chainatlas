import type { ChainSlug, ProtocolRegistryEntry, SwapRouteConfig } from "@chainatlas/shared";

export function getSwapRoutes(registry: ProtocolRegistryEntry[]) {
  return registry
    .filter((entry) => entry.kind === "swap")
    .flatMap((entry) => entry.swapRoutes ?? [])
    .filter((route) => route.enabled);
}

export function getSwapRoutesForChain(registry: ProtocolRegistryEntry[], chain: ChainSlug) {
  return getSwapRoutes(registry).filter((route) => route.chain === chain);
}

export function resolveSwapRoute(registry: ProtocolRegistryEntry[], routeId: string): SwapRouteConfig {
  const route = getSwapRoutes(registry).find((item) => item.routeId === routeId);
  if (!route) {
    throw new Error(`Unknown swap route: ${routeId}`);
  }
  return route;
}

export function getBridgeRegistryEntry(registry: ProtocolRegistryEntry[]) {
  return registry.find((entry) => entry.kind === "bridge" && entry.execution.type === "bridge.across");
}

