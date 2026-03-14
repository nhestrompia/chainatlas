import { runtimeConfig } from "@/lib/config/runtime";
import {
  type AvatarId,
  type ChainSlug,
  type PortfolioAsset,
} from "@chainatlas/shared";
import { getAddress, isAddress, type Address } from "viem";
import { CHARACTER_OPTIONS, type SupportedErc20Token } from "./constants";

export function isAvatarId(value: string | null): value is AvatarId {
  return CHARACTER_OPTIONS.some((option) => option.id === value);
}

export function shortenIdentity(value?: string) {
  if (!value) {
    return "Preview";
  }

  const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(value);
  if (!isWalletAddress) {
    return value;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function shortAddress(value?: string) {
  if (!value) {
    return "Unknown";
  }
  if (!value.startsWith("0x") || value.length < 10) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function avatarStorageKey(address: string) {
  return `chainatlas:selected-avatar:${address.toLowerCase()}`;
}

export function mergePortfolioAssets(...collections: PortfolioAsset[][]) {
  const map = new Map<string, PortfolioAsset>();

  for (const assets of collections) {
    for (const asset of assets) {
      const key = `${asset.chain}:${asset.address}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, asset);
      }
    }
  }

  return [...map.values()];
}

export function toAssetKey(
  chain: string | undefined,
  address: string | undefined,
) {
  if (!chain || !address) {
    return undefined;
  }
  return `${chain}:${address}`.toLowerCase();
}

export function toPortfolioAssetFromNativeBalance(
  chain: ChainSlug,
  value: bigint | undefined,
  formatted: string | undefined,
): PortfolioAsset | undefined {
  if (!value || value <= 0n || !formatted) {
    return undefined;
  }

  return {
    chain,
    address: "native",
    symbol: "ETH",
    name: "Ether",
    balance: formatted,
    decimals: 18,
    usdValue: 0,
    verified: true,
  };
}

export function getSupportedErc20Tokens(
  chain: ChainSlug,
): SupportedErc20Token[] {
  const tokens = new Map<string, SupportedErc20Token>();

  for (const entry of runtimeConfig.protocolRegistry) {
    for (const token of entry.supportedTokens) {
      if (
        token.chain !== chain ||
        token.address === "native" ||
        !isAddress(token.address)
      ) {
        continue;
      }

      const address = getAddress(token.address) as Address;
      const key = `${chain}:${address}`.toLowerCase();
      if (tokens.has(key)) {
        continue;
      }

      const decimals =
        typeof token.decimals === "number" && Number.isFinite(token.decimals)
          ? token.decimals
          : 18;

      tokens.set(key, {
        address,
        symbol: token.symbol,
        decimals,
        name: token.symbol === "USDC" ? "USD Coin" : token.symbol,
      });
    }
  }

  return [...tokens.values()];
}

export function resolveReadContractBigInt(value: unknown) {
  if (typeof value === "bigint") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const resultRecord = value as { result?: unknown; status?: unknown };
  if (
    typeof resultRecord.status === "string" &&
    resultRecord.status !== "success"
  ) {
    return undefined;
  }

  return typeof resultRecord.result === "bigint"
    ? resultRecord.result
    : undefined;
}
