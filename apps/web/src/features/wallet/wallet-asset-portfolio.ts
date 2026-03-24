import type { ChainSlug, PortfolioAsset } from "@chainatlas/shared";
import { formatUnits, getAddress } from "viem";

type EthereumProviderWithRequest = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type WalletWithProvider = {
  getEthereumProvider(): Promise<EthereumProviderWithRequest>;
};

export function resolveChainSlug(value: unknown): ChainSlug | undefined {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      resolveChainSlug(record.chainId) ??
      resolveChainSlug(record.id) ??
      resolveChainSlug(record.chain) ??
      resolveChainSlug(record.slug) ??
      resolveChainSlug(record.name)
    );
  }

  if (typeof value === "number") {
    if (value === 1 || value === 11155111) return "ethereum";
    if (value === 8453 || value === 84532) return "base";
    if (value === 137 || value === 80002) return "polygon";
    return undefined;
  }

  if (typeof value === "string") {
    if (value.startsWith("eip155:")) {
      return resolveChainSlug(Number(value.split(":")[1]));
    }
    if (value.startsWith("0x")) {
      return resolveChainSlug(Number.parseInt(value, 16));
    }

    const maybeNumeric = Number(value);
    if (!Number.isNaN(maybeNumeric)) {
      return resolveChainSlug(maybeNumeric);
    }

    const normalized = value.toLowerCase();
    if (normalized === "ethereum" || normalized === "sepolia") return "ethereum";
    if (normalized === "base" || normalized === "base-sepolia") return "base";
    if (normalized === "polygon" || normalized === "matic" || normalized === "amoy") return "polygon";
    if (normalized.includes("polygon") || normalized.includes("matic")) return "polygon";
    if (normalized.includes("base")) return "base";
    if (normalized.includes("ethereum") || normalized.includes("eth") || normalized.includes("sepolia")) {
      return "ethereum";
    }
  }

  return undefined;
}

function resolveDecimals(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 18;
}

function resolveDecimalBalance(raw: unknown, decimals: number): string | undefined {
  if (typeof raw === "string") {
    if (raw.startsWith("0x")) {
      return formatUnits(BigInt(raw), decimals);
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return raw;
    }
    return undefined;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw.toString();
  }

  if (typeof raw === "bigint") {
    return formatUnits(raw, decimals);
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return (
      resolveDecimalBalance(record.formatted, decimals) ??
      resolveDecimalBalance(record.display, decimals) ??
      resolveDecimalBalance(record.numeric, decimals) ??
      resolveDecimalBalance(record.amount, decimals) ??
      resolveDecimalBalance(record.quantity, decimals) ??
      resolveDecimalBalance(record.hex, decimals) ??
      resolveDecimalBalance(record.raw, decimals) ??
      resolveDecimalBalance(record.value, decimals)
    );
  }

  return undefined;
}

function collectAssetEntries(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const nestedArrays = [
    root.assets,
    root.tokens,
    root.fungibleTokens,
    root.balances,
    root.result,
    root.data,
    root.response,
  ];

  for (const candidate of nestedArrays) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const inner =
        nested.assets ??
        nested.tokens ??
        nested.fungibleTokens ??
        nested.balances ??
        nested.result ??
        nested.data ??
        nested.response;
      if (Array.isArray(inner)) {
        return inner.filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
        );
      }
    }
  }

  return [];
}

function mapProviderAssetToPortfolioAsset(asset: Record<string, unknown>): PortfolioAsset | undefined {
  const network =
    asset.network && typeof asset.network === "object"
      ? (asset.network as Record<string, unknown>)
      : undefined;
  const tokenInfo =
    asset.token && typeof asset.token === "object"
      ? (asset.token as Record<string, unknown>)
      : undefined;

  const chain = resolveChainSlug(
    asset.chainId ??
      asset.chain ??
      network?.chainId ??
      network?.chain ??
      network?.id ??
      network?.name ??
      tokenInfo?.chainId ??
      tokenInfo?.chain,
  );

  if (!chain) {
    return undefined;
  }

  const addressValue = asset.address ?? asset.tokenAddress ?? asset.contractAddress ?? tokenInfo?.address;
  const symbolValue = asset.symbol ?? tokenInfo?.symbol;
  const nameValue = asset.name ?? tokenInfo?.name ?? symbolValue;
  const quantityInfo =
    asset.quantity && typeof asset.quantity === "object"
      ? (asset.quantity as Record<string, unknown>)
      : undefined;
  const decimals = resolveDecimals(asset.decimals ?? tokenInfo?.decimals ?? quantityInfo?.decimals);
  const balance = resolveDecimalBalance(
    asset.balance ?? asset.balanceRaw ?? asset.amount ?? asset.quantity ?? tokenInfo?.balance,
    decimals,
  );

  if (!balance || Number(balance) <= 0) {
    return undefined;
  }

  const isNative = !addressValue || addressValue === "native" || symbolValue === "ETH";
  const address = isNative
    ? "native"
    : typeof addressValue === "string"
      ? getAddress(addressValue)
      : undefined;

  if (!address) {
    return undefined;
  }

  return {
    chain,
    address,
    symbol: typeof symbolValue === "string" ? symbolValue : isNative ? "ETH" : "TOKEN",
    name: typeof nameValue === "string" ? nameValue : "Token",
    balance,
    decimals,
    usdValue: 0,
    verified: true,
  };
}

export async function fetchWalletPortfolio(
  wallet: WalletWithProvider,
  chain?: ChainSlug,
): Promise<PortfolioAsset[]> {
  const provider = await wallet.getEthereumProvider();
  const chainIds = chain
    ? chain === "base"
      ? ["eip155:8453", "eip155:84532"]
      : ["eip155:1", "eip155:11155111"]
    : ["eip155:1", "eip155:8453", "eip155:11155111", "eip155:84532"];

  const attempts: Array<{ method: string; params?: unknown[] }> = [
    { method: "wallet_getAssets", params: [] },
    {
      method: "wallet_getAssets",
      params: [{ chainIds }],
    },
  ];

  const assets = new Map<string, PortfolioAsset>();

  for (const attempt of attempts) {
    try {
      const payload = await provider.request({
        method: attempt.method,
        params: attempt.params,
      });

      for (const rawAsset of collectAssetEntries(payload)) {
        try {
          const asset = mapProviderAssetToPortfolioAsset(rawAsset);
          if (!asset) continue;
          if (chain && asset.chain !== chain) continue;
          const key = `${asset.chain}:${asset.address}`.toLowerCase();
          if (!assets.has(key)) {
            assets.set(key, asset);
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return [...assets.values()];
}
