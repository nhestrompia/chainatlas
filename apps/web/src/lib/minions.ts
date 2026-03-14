import type { PortfolioAsset, TokenMinion } from "@chainatlas/shared";

function assetKey(asset: PortfolioAsset) {
  return `${asset.chain}:${asset.address}`.toLowerCase();
}

export function deriveMinions(assets: PortfolioAsset[], supportedAssetKeys: Set<string>) {
  const sorted = [...assets].sort((left, right) => right.usdValue - left.usdValue);
  const visible = sorted;

  const minions: TokenMinion[] = visible.map((asset, index) => ({
    id: `minion:${assetKey(asset)}`,
    assetKey: assetKey(asset),
    chain: asset.chain,
    symbol: asset.symbol,
    name: asset.name,
    balance: asset.balance,
    usdValue: asset.usdValue,
    hue: (index * 43 + asset.symbol.charCodeAt(0)) % 360,
    scale: Math.max(0.65, Math.min(1.35, 0.65 + asset.usdValue / 5000)),
    orbitRadius: 1.6 + index * 0.45,
    bobOffset: index * 0.7,
    priority: index,
    actionable: supportedAssetKeys.has(assetKey(asset)),
  }));

  return {
    minions,
    summary: {
      total: assets.length,
      visibleSymbols: visible.map((asset) => asset.symbol),
    },
  };
}
