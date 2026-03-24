import { Interface } from "ethers";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { base, baseSepolia, mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";
import {
  getRuntimeProtocolConfig,
  resolveRuntimeProfile,
  type ChainSlug,
  type MerchantListing,
  type PortfolioAsset,
  type ProtocolRegistryEntry,
  type RuntimeAddressOverrides,
  type RuntimeProfile,
} from "@chainatlas/shared";

export type ApiDataEnv = Record<string, unknown>;

export type ApiDataService = {
  listPortfolio: (address: string) => Promise<PortfolioAsset[]>;
  listProtocolRegistry: () => ProtocolRegistryEntry[];
  listWalletNfts: (address: string, chain: ChainSlug, cursor?: string) => Promise<ApiWalletNftResponse>;
  getOpenSeaRequiredFees: (
    request: ApiOpenSeaRequiredFeesRequest,
  ) => Promise<ApiOpenSeaRequiredFeesResponse>;
  createOpenSeaListing: (
    request: ApiOpenSeaCreateListingRequest,
  ) => Promise<ApiOpenSeaCreateListingResponse>;
  listOpenSeaListings: (
    address: string,
    chain: ChainSlug,
    limit?: number,
  ) => Promise<ApiOpenSeaListingsResponse>;
  buildOpenSeaFulfillment: (request: ApiOpenSeaFulfillmentRequest) => Promise<ApiOpenSeaFulfillmentResponse>;
};

export type ApiWalletNft = {
  contractAddress: string;
  tokenId: string;
  collectionName: string;
  tokenName: string;
  imageUrl?: string;
  tokenStandard?: "erc721" | "erc1155" | "unknown";
};

export type ApiWalletNftResponse = {
  nfts: ApiWalletNft[];
  nextCursor?: string;
};

export type ApiOpenSeaListingsResponse = {
  listings: MerchantListing[];
};

export type ApiOpenSeaCreateListingRequest = {
  chain: ChainSlug;
  order: {
    parameters: Record<string, unknown>;
    signature: string;
  };
};

export type ApiOpenSeaCreateListingResponse = {
  orderHash?: string;
};

export type ApiOpenSeaRequiredFeesRequest = {
  chain: ChainSlug;
  nftContract: string;
  tokenId: string;
};

export type ApiOpenSeaRequiredFeesResponse = {
  collection?: string;
  fees: Array<{
    recipient: string;
    basisPoints: number;
  }>;
};

export type ApiOpenSeaFulfillmentRequest = {
  chain: ChainSlug;
  orderHash: string;
  protocolAddress?: string;
  fulfiller: string;
  nftContract?: string;
  tokenId?: string;
};

export type ApiOpenSeaFulfillmentResponse = {
  to: string;
  from?: string;
  value: string;
  data: string;
};

const alchemyDiscoveryNetworks = ["eth-mainnet", "base-mainnet", "eth-sepolia", "base-sepolia"] as const;
const PORTFOLIO_PROFILE_TIMEOUT_MS = 8_000;
const RPC_READ_TIMEOUT_MS = 4_000;
const ALCHEMY_ENDPOINT_PATHS = ["assets/tokens/by-address", "assets/tokens/balances/by-address"] as const;
const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const DEFAULT_OPENSEA_PROTOCOL_ADDRESS =
  "0x0000000000000068F116a894984e2DB1123eB395";
const DEFAULT_OPENSEA_FEE_RECIPIENT =
  "0x0000a26b00c1F0DF003000390027140000fAa719";
const ALCHEMY_NFT_API_BASE = "https://%NETWORK%.g.alchemy.com/nft/v3";
class OpenSeaRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenSea request failed (${status}): ${body}`);
    this.name = "OpenSeaRequestError";
    this.status = status;
    this.body = body;
  }
}

const nativeAssetMeta: Record<ChainSlug, Omit<PortfolioAsset, "balance" | "usdValue">> = {
  ethereum: {
    chain: "ethereum",
    address: "native",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    verified: true,
  },
  base: {
    chain: "base",
    address: "native",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    verified: true,
  },
  polygon: {
    chain: "polygon",
    address: "native",
    symbol: "MATIC",
    name: "MATIC",
    decimals: 18,
    verified: true,
  },
};

function getEnvString(env: ApiDataEnv, key: string) {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalAddressEnv(env: ApiDataEnv, ...keys: string[]) {
  for (const key of keys) {
    const value = getEnvString(env, key);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function resolveChain(slug: ChainSlug, profile: RuntimeProfile) {
  if (slug === "ethereum") {
    return profile === "testnet" ? sepolia : mainnet;
  }
  if (slug === "polygon") {
    return profile === "testnet" ? polygonAmoy : polygon;
  }

  return profile === "testnet" ? baseSepolia : base;
}

function resolveRpcUrl(env: ApiDataEnv, slug: ChainSlug, profile: RuntimeProfile) {
  if (slug === "ethereum") {
    if (profile === "testnet") {
      return getEnvString(env, "SEPOLIA_RPC_URL") ?? getEnvString(env, "ETHEREUM_RPC_URL");
    }

    return getEnvString(env, "ETHEREUM_RPC_URL");
  }
  if (slug === "polygon") {
    if (profile === "testnet") {
      return getEnvString(env, "POLYGON_AMOY_RPC_URL") ?? getEnvString(env, "POLYGON_RPC_URL");
    }
    return getEnvString(env, "POLYGON_RPC_URL");
  }

  if (profile === "testnet") {
    return getEnvString(env, "BASE_SEPOLIA_RPC_URL") ?? getEnvString(env, "BASE_RPC_URL");
  }

  return getEnvString(env, "BASE_RPC_URL");
}

function resolveOpenSeaProtocolAddress(env: ApiDataEnv, chain: ChainSlug) {
  const specificAddress =
    chain === "ethereum"
      ? optionalAddressEnv(env, "OPENSEA_PROTOCOL_ADDRESS_ETHEREUM")
      : chain === "base"
        ? optionalAddressEnv(env, "OPENSEA_PROTOCOL_ADDRESS_BASE")
        : optionalAddressEnv(env, "OPENSEA_PROTOCOL_ADDRESS_POLYGON");
  const configured =
    specificAddress ?? optionalAddressEnv(env, "OPENSEA_PROTOCOL_ADDRESS");
  const candidate = configured ?? DEFAULT_OPENSEA_PROTOCOL_ADDRESS;
  try {
    return getAddress(candidate);
  } catch {
    return DEFAULT_OPENSEA_PROTOCOL_ADDRESS;
  }
}

function createRuntimeAddressOverrides(env: ApiDataEnv): RuntimeAddressOverrides {
  return {
    uniswapRouterEthereum: optionalAddressEnv(env, "UNISWAP_ROUTER_ETHEREUM", "VITE_UNISWAP_ROUTER_ETHEREUM"),
    uniswapRouterBase: optionalAddressEnv(env, "UNISWAP_ROUTER_BASE", "VITE_UNISWAP_ROUTER_BASE"),
    aerodromeRouterBase: optionalAddressEnv(env, "AERODROME_ROUTER_BASE", "VITE_AERODROME_ROUTER_BASE"),
    aerodromeFactoryBase: optionalAddressEnv(env, "AERODROME_FACTORY_BASE", "VITE_AERODROME_FACTORY_BASE"),
    acrossSpokePoolEthereum: optionalAddressEnv(
      env,
      "ACROSS_SPOKE_POOL_ETHEREUM",
      "VITE_ACROSS_SPOKE_POOL_ETHEREUM",
    ),
    acrossSpokePoolBase: optionalAddressEnv(env, "ACROSS_SPOKE_POOL_BASE", "VITE_ACROSS_SPOKE_POOL_BASE"),
    acrossSpokePoolPolygon: optionalAddressEnv(
      env,
      "ACROSS_SPOKE_POOL_POLYGON",
      "VITE_ACROSS_SPOKE_POOL_POLYGON",
    ),
    wrappedNativeEthereum: optionalAddressEnv(env, "WRAPPED_NATIVE_ETHEREUM", "VITE_WRAPPED_NATIVE_ETHEREUM"),
    wrappedNativeBase: optionalAddressEnv(env, "WRAPPED_NATIVE_BASE", "VITE_WRAPPED_NATIVE_BASE"),
    wrappedNativePolygon: optionalAddressEnv(env, "WRAPPED_NATIVE_POLYGON", "VITE_WRAPPED_NATIVE_POLYGON"),
    usdcEthereum: optionalAddressEnv(env, "USDC_ETHEREUM", "VITE_USDC_ETHEREUM"),
    usdcBase: optionalAddressEnv(env, "USDC_BASE", "VITE_USDC_BASE"),
    usdcPolygon: optionalAddressEnv(env, "USDC_POLYGON", "VITE_USDC_POLYGON"),
    usdtEthereum: optionalAddressEnv(env, "USDT_ETHEREUM", "VITE_USDT_ETHEREUM"),
    usdtBase: optionalAddressEnv(env, "USDT_BASE", "VITE_USDT_BASE"),
  };
}

function createPublicClients(env: ApiDataEnv) {
  return {
    testnet: {
      ethereum: createPublicClient({
        chain: resolveChain("ethereum", "testnet"),
        transport: http(
          resolveRpcUrl(env, "ethereum", "testnet") ??
            resolveChain("ethereum", "testnet").rpcUrls.default.http[0],
        ),
      }),
      base: createPublicClient({
        chain: resolveChain("base", "testnet"),
        transport: http(resolveRpcUrl(env, "base", "testnet") ?? resolveChain("base", "testnet").rpcUrls.default.http[0]),
      }),
      polygon: createPublicClient({
        chain: resolveChain("polygon", "testnet"),
        transport: http(resolveChain("polygon", "testnet").rpcUrls.default.http[0]),
      }),
    },
    mainnet: {
      ethereum: createPublicClient({
        chain: resolveChain("ethereum", "mainnet"),
        transport: http(
          resolveRpcUrl(env, "ethereum", "mainnet") ??
            resolveChain("ethereum", "mainnet").rpcUrls.default.http[0],
        ),
      }),
      base: createPublicClient({
        chain: resolveChain("base", "mainnet"),
        transport: http(resolveRpcUrl(env, "base", "mainnet") ?? resolveChain("base", "mainnet").rpcUrls.default.http[0]),
      }),
      polygon: createPublicClient({
        chain: resolveChain("polygon", "mainnet"),
        transport: http(resolveChain("polygon", "mainnet").rpcUrls.default.http[0]),
      }),
    },
  } as const;
}

function buildTokenMetadata(runtimeConfigByProfile: Record<RuntimeProfile, ReturnType<typeof getRuntimeProtocolConfig>>) {
  const metadata = new Map<string, Pick<PortfolioAsset, "name" | "symbol" | "decimals" | "verified">>();

  for (const profileConfig of Object.values(runtimeConfigByProfile)) {
    for (const asset of profileConfig.bridge.supportedAssets) {
      if (asset.address === "native") {
        continue;
      }

      const key = `${asset.chain}:${asset.address}`.toLowerCase();
      if (metadata.has(key)) {
        continue;
      }

      const symbol = asset.symbol.toUpperCase();
      const name = symbol === "USDC" ? "USD Coin" : symbol === "USDT" ? "Tether USD" : asset.symbol;

      metadata.set(key, {
        name,
        symbol: asset.symbol,
        decimals: asset.decimals ?? 18,
        verified: true,
      });
    }
  }

  return metadata;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function uniqueSupportedTokens(registry: ProtocolRegistryEntry[]) {
  const map = new Map<string, { chain: ChainSlug; address: string | "native"; symbol: string }>();

  for (const entry of registry) {
    for (const token of entry.supportedTokens) {
      map.set(`${token.chain}:${token.address}`.toLowerCase(), token);
    }
  }

  return [...map.values()];
}

function dedupeAssets(assets: PortfolioAsset[]) {
  const deduped = new Map<string, PortfolioAsset>();

  for (const asset of assets) {
    const key = `${asset.chain}:${asset.address}`.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, asset);
    }
  }

  return [...deduped.values()];
}

function isOpenSeaRateLimitError(error: unknown): boolean {
  return error instanceof OpenSeaRequestError && error.status === 429;
}

function alchemyNetworkToChainSlug(network: unknown): ChainSlug | undefined {
  if (typeof network !== "string") {
    return undefined;
  }

  const normalized = network.toLowerCase();
  if (normalized.startsWith("eth-") || normalized.includes("ethereum")) {
    return "ethereum";
  }

  if (normalized.startsWith("base-")) {
    return "base";
  }

  return undefined;
}

function openSeaChainName(chain: ChainSlug) {
  if (chain === "ethereum") {
    return "ethereum";
  }
  if (chain === "base") {
    return "base";
  }
  return "polygon";
}

function alchemyNftNetworkName(chain: ChainSlug, profile: RuntimeProfile) {
  if (chain === "ethereum") {
    return profile === "testnet" ? "eth-sepolia" : "eth-mainnet";
  }
  if (chain === "base") {
    return profile === "testnet" ? "base-sepolia" : "base-mainnet";
  }
  return profile === "testnet" ? "polygon-amoy" : "polygon-mainnet";
}

function toLowerAddress(address: string) {
  try {
    return getAddress(address).toLowerCase();
  } catch {
    return address.toLowerCase();
  }
}

function parseNumberishString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return undefined;
}

function parseOpenSeaPriceAmount(value: unknown): string | undefined {
  const directAmount = parseNumberishString(value);
  if (directAmount) {
    return directAmount;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const currentRecord =
    record.current && typeof record.current === "object"
      ? (record.current as Record<string, unknown>)
      : undefined;
  const amountRecord =
    record.amount && typeof record.amount === "object"
      ? (record.amount as Record<string, unknown>)
      : undefined;
  return (
    parseNumberishString(record.value) ??
    parseNumberishString(record.amount) ??
    parseNumberishString(record.current_price) ??
    parseNumberishString(currentRecord?.value) ??
    parseNumberishString(currentRecord?.amount) ??
    parseNumberishString(amountRecord?.value)
  );
}

function parseOpenSeaItemType(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  if (normalized === "native" || normalized === "native_token") {
    return 0;
  }
  if (normalized === "erc20") {
    return 1;
  }
  if (normalized === "erc721") {
    return 2;
  }
  if (normalized === "erc1155") {
    return 3;
  }
  return undefined;
}

function sumNumberishStrings(values: string[]) {
  if (values.length === 0) {
    return undefined;
  }
  let total = 0n;
  let consumed = false;
  for (const value of values) {
    try {
      total += BigInt(value);
      consumed = true;
    } catch {
      // Ignore malformed amounts.
    }
  }
  return consumed ? total.toString() : undefined;
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("ipfs://")) {
    const ipfsPath = trimmed.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
    if (!ipfsPath) {
      return undefined;
    }
    return `https://ipfs.io/ipfs/${ipfsPath}`;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("https://")) {
    return trimmed;
  }
  return undefined;
}

function firstImageUrl(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeTokenStandard(value: unknown): ApiWalletNft["tokenStandard"] {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "erc721") {
    return "erc721";
  }
  if (normalized === "erc1155") {
    return "erc1155";
  }
  return "unknown";
}

function parseOpenSeaNftsResponse(payload: unknown): ApiWalletNftResponse {
  if (!payload || typeof payload !== "object") {
    return { nfts: [] };
  }
  const record = payload as Record<string, unknown>;
  const rawNfts = Array.isArray(record.nfts) ? record.nfts : [];
  const nfts = rawNfts.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const nft = item as Record<string, unknown>;
    const contractAddress =
      typeof nft.contract === "string"
        ? nft.contract
        : nft.contract && typeof nft.contract === "object"
          ? (nft.contract as Record<string, unknown>).address
          : undefined;
    const tokenId = parseNumberishString(nft.identifier ?? nft.token_id);
    if (typeof contractAddress !== "string" || !tokenId) {
      return [];
    }
    const collectionName =
      typeof nft.collection === "string"
        ? nft.collection
        : nft.collection && typeof nft.collection === "object"
          ? ((nft.collection as Record<string, unknown>).name as string | undefined)
          : undefined;
    const tokenName =
      typeof nft.name === "string" && nft.name.trim().length > 0
        ? nft.name
        : `${collectionName ?? "NFT"} #${tokenId}`;
    const imageRecord =
      nft.image && typeof nft.image === "object"
        ? (nft.image as Record<string, unknown>)
        : undefined;
    const imageUrl = firstImageUrl(
      nft.image_url,
      nft.display_image_url,
      nft.image_preview_url,
      nft.image_thumbnail_url,
      nft.image_original_url,
      imageRecord?.cachedUrl,
      imageRecord?.thumbnailUrl,
      imageRecord?.originalUrl,
      imageRecord?.url,
      imageRecord?.preview_url,
    );
    const tokenStandard = normalizeTokenStandard(
      nft.token_standard ??
        (nft.contract && typeof nft.contract === "object"
          ? (nft.contract as Record<string, unknown>).token_standard
          : undefined),
    );
    return [
      {
        contractAddress: toLowerAddress(contractAddress),
        tokenId,
        collectionName: collectionName ?? "Collection",
        tokenName,
        imageUrl,
        tokenStandard,
      } satisfies ApiWalletNft,
    ];
  });
  const nextCursor = typeof record.next === "string" ? record.next : undefined;
  return { nfts, nextCursor };
}

function parseAlchemyNftsResponse(payload: unknown): ApiWalletNftResponse {
  if (!payload || typeof payload !== "object") {
    return { nfts: [] };
  }
  const record = payload as Record<string, unknown>;
  const rawOwnedNfts = Array.isArray(record.ownedNfts) ? record.ownedNfts : [];
  const nfts = rawOwnedNfts.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const nft = item as Record<string, unknown>;
    const contractRecord =
      nft.contract && typeof nft.contract === "object"
        ? (nft.contract as Record<string, unknown>)
        : undefined;
    const contractAddress =
      typeof contractRecord?.address === "string"
        ? contractRecord.address
        : typeof nft.contractAddress === "string"
          ? nft.contractAddress
          : undefined;
    const tokenId = parseNumberishString(
      nft.tokenId ??
        nft.token_id ??
        nft.identifier,
    );
    if (!contractAddress || !tokenId) {
      return [];
    }
    const normalizedTokenId = tokenId.startsWith("0x")
      ? (() => {
          try {
            return BigInt(tokenId).toString();
          } catch {
            return tokenId;
          }
        })()
      : tokenId;

    const collectionRecord =
      nft.collection && typeof nft.collection === "object"
        ? (nft.collection as Record<string, unknown>)
        : undefined;
    const imageRecord =
      nft.image && typeof nft.image === "object"
        ? (nft.image as Record<string, unknown>)
        : undefined;
    const collectionName =
      typeof collectionRecord?.name === "string"
        ? collectionRecord.name
        : typeof nft.collectionName === "string"
          ? nft.collectionName
          : "Collection";
    const tokenName =
      typeof nft.name === "string" && nft.name.trim().length > 0
        ? nft.name
        : typeof nft.title === "string" && nft.title.trim().length > 0
          ? nft.title
          : `${collectionName} #${normalizedTokenId}`;
    const metadataRecord =
      nft.metadata && typeof nft.metadata === "object"
        ? (nft.metadata as Record<string, unknown>)
        : undefined;
    const rawMetadataRecord =
      nft.rawMetadata && typeof nft.rawMetadata === "object"
        ? (nft.rawMetadata as Record<string, unknown>)
        : undefined;
    const mediaArray = Array.isArray(nft.media) ? nft.media : [];
    const firstMedia =
      mediaArray[0] && typeof mediaArray[0] === "object"
        ? (mediaArray[0] as Record<string, unknown>)
        : undefined;
    const imageUrl = firstImageUrl(
      imageRecord?.cachedUrl,
      imageRecord?.thumbnailUrl,
      imageRecord?.originalUrl,
      imageRecord?.pngUrl,
      imageRecord?.url,
      imageRecord?.preview_url,
      nft.image_url,
      nft.image_original_url,
      firstMedia?.gateway,
      firstMedia?.thumbnail,
      firstMedia?.raw,
      metadataRecord?.image,
      rawMetadataRecord?.image,
      rawMetadataRecord?.image_url,
    );
    const tokenStandard = normalizeTokenStandard(
      nft.tokenType ??
        nft.token_type ??
        contractRecord?.tokenType ??
        contractRecord?.token_type,
    );
    return [
      {
        contractAddress: toLowerAddress(contractAddress),
        tokenId: normalizedTokenId,
        collectionName,
        tokenName,
        imageUrl,
        tokenStandard,
      } satisfies ApiWalletNft,
    ];
  });
  const nextCursor = typeof record.pageKey === "string" ? record.pageKey : undefined;
  return { nfts, nextCursor };
}

function dedupeWalletNfts(nfts: ApiWalletNft[]) {
  const deduped = new Map<string, ApiWalletNft>();
  for (const nft of nfts) {
    const key = `${nft.contractAddress.toLowerCase()}:${nft.tokenId}`;
    if (!deduped.has(key)) {
      deduped.set(key, nft);
    }
  }
  return [...deduped.values()];
}

function parseOpenSeaListingsResponse(payload: unknown, chain: ChainSlug): ApiOpenSeaListingsResponse {
  if (!payload || typeof payload !== "object") {
    return { listings: [] };
  }
  const record = payload as Record<string, unknown>;
  const now = Date.now();
  const listingsArray = Array.isArray(record.orders)
    ? record.orders
    : Array.isArray(record.listings)
      ? record.listings
      : [];
  const listings = listingsArray.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const entry = item as Record<string, unknown>;
    const orderHash =
      typeof entry.order_hash === "string"
        ? entry.order_hash
        : typeof entry.orderHash === "string"
          ? entry.orderHash
          : undefined;
    const makerAddress =
      typeof entry.maker === "string"
        ? entry.maker
        : entry.maker && typeof entry.maker === "object"
          ? ((entry.maker as Record<string, unknown>).address as string | undefined)
          : undefined;
    const protocolData = entry.protocol_data as Record<string, unknown> | undefined;
    const parameters = protocolData?.parameters as Record<string, unknown> | undefined;
    const signature =
      typeof protocolData?.signature === "string"
        ? protocolData.signature
        : undefined;
    const consideration = Array.isArray(parameters?.consideration)
      ? (parameters?.consideration as Array<Record<string, unknown>>)
      : [];
    const offer = Array.isArray(parameters?.offer)
      ? (parameters?.offer as Array<Record<string, unknown>>)
      : [];
    const nftOffer = offer.find((itemOffer) => {
      const itemType = parseOpenSeaItemType(itemOffer.itemType ?? itemOffer.item_type);
      return itemType === 2 || itemType === 3;
    });
    const payment = consideration.find((itemConsideration) => {
      const itemType = parseOpenSeaItemType(
        itemConsideration.itemType ?? itemConsideration.item_type,
      );
      return itemType === 0;
    });
    const nativeConsiderationStartAmounts = consideration
      .filter((itemConsideration) => {
        const itemType = parseOpenSeaItemType(
          itemConsideration.itemType ?? itemConsideration.item_type,
        );
        return itemType === 0;
      })
      .flatMap((itemConsideration) => {
        const amount = parseOpenSeaPriceAmount(
          itemConsideration.startAmount ?? itemConsideration.start_amount,
        );
        return amount ? [amount] : [];
      });
    const totalNativeConsiderationAmount = sumNumberishStrings(
      nativeConsiderationStartAmounts,
    );
    const priceRecord =
      entry.price && typeof entry.price === "object"
        ? (entry.price as Record<string, unknown>)
        : undefined;
    const contractAddress = parseNumberishString(nftOffer?.token ?? entry.asset_contract_address);
    const tokenId = parseNumberishString(
      nftOffer?.identifierOrCriteria ??
        nftOffer?.identifier_or_criteria ??
        entry.token_id ??
        entry.identifier,
    );
    const startAmount =
      parseOpenSeaPriceAmount(entry.current_price) ??
      parseOpenSeaPriceAmount(priceRecord?.value ?? priceRecord) ??
      parseOpenSeaPriceAmount(entry.sale_price) ??
      totalNativeConsiderationAmount ??
      parseOpenSeaPriceAmount(payment?.startAmount ?? payment?.start_amount);
    const tokenName =
      typeof entry.asset_name === "string"
        ? entry.asset_name
        : typeof entry.title === "string"
          ? entry.title
          : tokenId
            ? `NFT #${tokenId}`
            : "NFT";
    const collectionName =
      typeof entry.collection === "string"
        ? entry.collection
        : entry.collection && typeof entry.collection === "object"
          ? ((entry.collection as Record<string, unknown>).name as string | undefined)
          : "Collection";
    const assetRecord =
      entry.asset && typeof entry.asset === "object"
        ? (entry.asset as Record<string, unknown>)
        : undefined;
    const imageUrl = firstImageUrl(
      entry.image_url,
      entry.display_image_url,
      entry.image_preview_url,
      entry.image_thumbnail_url,
      assetRecord?.image_url,
      assetRecord?.display_image_url,
      assetRecord?.image_preview_url,
      assetRecord?.image_thumbnail_url,
    );
    const expirationTime =
      parseNumberishString(entry.expiration_time) ??
      parseNumberishString(parameters?.endTime ?? parameters?.end_time);
    if (
      typeof orderHash !== "string" ||
      typeof makerAddress !== "string" ||
      typeof contractAddress !== "string" ||
      !tokenId ||
      !startAmount
    ) {
      return [];
    }
    const expirySeconds = expirationTime ? Number(expirationTime) : undefined;
    const expiryMs =
      typeof expirySeconds === "number" && Number.isFinite(expirySeconds)
        ? expirySeconds * 1000
        : undefined;
    if (typeof expiryMs === "number" && expiryMs <= now) {
      return [];
    }
    return [
      {
        listingId: orderHash,
        orderHash,
        source: "opensea",
        status: "active",
        seller: toLowerAddress(makerAddress),
        chain,
        nftContract: toLowerAddress(contractAddress),
        tokenId,
        collectionName: collectionName ?? "Collection",
        tokenName,
        imageUrl,
        priceWei: startAmount,
        currencySymbol: "ETH",
        expiry: expiryMs,
        createdAt: now,
        updatedAt: now,
        ...(parameters
          ? {
              seaportOrder: signature
                ? { parameters, signature }
                : { parameters },
            }
          : {}),
      } satisfies MerchantListing,
    ];
  });
  return { listings };
}

function extractOpenSeaTxInputHex(transaction: Record<string, unknown>) {
  const txInputData =
    transaction.input_data && typeof transaction.input_data === "object"
      ? (transaction.input_data as Record<string, unknown>)
      : transaction.inputData && typeof transaction.inputData === "object"
        ? (transaction.inputData as Record<string, unknown>)
        : undefined;
  const directCandidate =
    (typeof transaction.data === "string" ? transaction.data : undefined) ??
    (typeof transaction.input_data === "string" ? transaction.input_data : undefined) ??
    (typeof transaction.inputData === "string" ? transaction.inputData : undefined) ??
    (typeof transaction.calldata === "string" ? transaction.calldata : undefined) ??
    (typeof transaction.callData === "string" ? transaction.callData : undefined) ??
    (typeof txInputData?.data === "string" ? txInputData.data : undefined) ??
    (typeof txInputData?.calldata === "string" ? txInputData.calldata : undefined) ??
    (typeof txInputData?.callData === "string" ? txInputData.callData : undefined);
  if (directCandidate) {
    return directCandidate;
  }
  const normalizedInputData = normalizeOpenSeaAbiArg(txInputData);
  if (
    typeof normalizedInputData === "string" &&
    /^0x[0-9a-fA-F]+$/.test(normalizedInputData) &&
    normalizedInputData.length % 2 === 0 &&
    normalizedInputData.length > 10
  ) {
    return normalizedInputData;
  }
  if (
    Array.isArray(normalizedInputData) &&
    normalizedInputData.length === 1 &&
    typeof normalizedInputData[0] === "string" &&
    /^0x[0-9a-fA-F]+$/.test(normalizedInputData[0]) &&
    normalizedInputData[0].length % 2 === 0 &&
    normalizedInputData[0].length > 10
  ) {
    return normalizedInputData[0];
  }
  const nestedInputCandidate = findLikelyCalldataHex(txInputData);
  if (nestedInputCandidate) {
    return nestedInputCandidate;
  }
  return findLikelyCalldataHex(transaction);
}

function extractOpenSeaFunctionName(value: string) {
  const trimmed = value.trim();
  const openParenIndex = trimmed.indexOf("(");
  if (openParenIndex <= 0) {
    return undefined;
  }
  return trimmed.slice(0, openParenIndex).trim();
}

function isLikelyHexData(value: string) {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    return false;
  }
  const hexLength = value.length - 2;
  if (hexLength === 8) {
    // 4-byte selector (function with no args)
    return true;
  }
  // ABI call data should be selector + 32-byte words.
  if (hexLength < 8 + 64) {
    return false;
  }
  return (hexLength - 8) % 64 === 0;
}

function scoreCalldataPath(path: string[]) {
  let score = 0;
  for (const segment of path) {
    if (!segment || /^\d+$/.test(segment)) {
      continue;
    }
    const normalized = segment.toLowerCase();
    if (normalized.includes("calldata") || normalized.includes("call_data")) {
      score += 6;
      continue;
    }
    if (normalized.includes("input_data") || normalized.includes("inputdata")) {
      score += 5;
      continue;
    }
    if (normalized.includes("data")) {
      score += 3;
      continue;
    }
    if (normalized.includes("payload")) {
      score += 1;
    }
  }
  return score;
}

function findLikelyCalldataHex(value: unknown) {
  if (!value) {
    return undefined;
  }
  type StackFrame = { value: unknown; path: string[]; depth: number };
  const stack: StackFrame[] = [{ value, path: [], depth: 0 }];
  const seen = new Set<unknown>();
  let best:
    | {
        hex: string;
        score: number;
      }
    | undefined;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    const current = frame.value;
    if (typeof current === "string") {
      const looksLikeCalldata = isLikelyHexData(current);
      const looksLikeHexBlob =
        /^0x[0-9a-fA-F]+$/.test(current) &&
        current.length % 2 === 0 &&
        current.length >= 66 &&
        current.length <= 12_288;
      if (!looksLikeCalldata && !looksLikeHexBlob) {
        continue;
      }
      const score = scoreCalldataPath(frame.path);
      if (score <= 0) {
        continue;
      }
      if (!looksLikeCalldata && score < 5) {
        continue;
      }
      if (
        !best ||
        score > best.score ||
        (score === best.score && current.length > best.hex.length)
      ) {
        best = { hex: current, score };
      }
      continue;
    }
    if (!current || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (frame.depth >= 8) {
      continue;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        stack.push({
          value: entry,
          path: [...frame.path, String(index)],
          depth: frame.depth + 1,
        });
      });
      continue;
    }
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      stack.push({
        value: entry,
        path: [...frame.path, key],
        depth: frame.depth + 1,
      });
    }
  }
  return best?.hex;
}

function normalizeOpenSeaAbiArg(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOpenSeaAbiArg(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, "value") &&
    (Object.keys(record).length <= 2 ||
      Object.prototype.hasOwnProperty.call(record, "typeAsString"))
  ) {
    return normalizeOpenSeaAbiArg(record.value);
  }
  const normalizedEntries = Object.entries(record).map(([key, nextValue]) => [
    key,
    normalizeOpenSeaAbiArg(nextValue),
  ]);
  return Object.fromEntries(normalizedEntries);
}

function resolveOpenSeaFunctionArgs(parameters: unknown, inputNames: string[]) {
  const normalizedParameters = normalizeOpenSeaAbiArg(parameters);
  if (Array.isArray(normalizedParameters)) {
    return normalizedParameters;
  }
  if (!normalizedParameters || typeof normalizedParameters !== "object") {
    return undefined;
  }
  const record = normalizedParameters as Record<string, unknown>;
  const valueList = Array.isArray(record.value)
    ? (record.value as unknown[]).map((entry) => normalizeOpenSeaAbiArg(entry))
    : undefined;
  if (valueList && valueList.length > 0) {
    if (inputNames.length === 1) {
      return [valueList[0]];
    }
    if (valueList.length === inputNames.length) {
      return valueList;
    }
  }
  if (inputNames.length === 1) {
    return [normalizedParameters];
  }
  const byName = inputNames.map((name) =>
    name && Object.prototype.hasOwnProperty.call(record, name)
      ? record[name]
      : undefined,
  );
  if (byName.every((value) => value !== undefined)) {
    return byName;
  }
  const byIndex = inputNames.map((_, index) => record[String(index)]);
  if (byIndex.every((value) => value !== undefined)) {
    return byIndex;
  }
  return undefined;
}

function encodeOpenSeaStructuredInputData(transaction: Record<string, unknown>) {
  const rawFunctionSignature =
    typeof transaction.function === "string" ? transaction.function.trim() : undefined;
  if (!rawFunctionSignature) {
    return undefined;
  }
  const functionSignature = rawFunctionSignature.replace(/^function\s+/i, "");
  const functionName = extractOpenSeaFunctionName(functionSignature);
  if (!functionName) {
    return undefined;
  }
  const inputData =
    transaction.input_data && typeof transaction.input_data === "object"
      ? (transaction.input_data as Record<string, unknown>)
      : transaction.inputData && typeof transaction.inputData === "object"
        ? (transaction.inputData as Record<string, unknown>)
        : undefined;
  if (!inputData) {
    return undefined;
  }
  const parameters =
    inputData.parameters ??
    inputData.params ??
    inputData.arguments ??
    inputData.args ??
    inputData.value ??
    inputData;
  try {
    const iface = new Interface([`function ${functionSignature}`]);
    const fragment = iface.getFunction(functionName);
    if (!fragment) {
      return undefined;
    }
    const args =
      fragment.inputs.length === 0
        ? []
        : resolveOpenSeaFunctionArgs(
            parameters,
            fragment.inputs.map((input) => input.name),
          );
    if (!args) {
      return undefined;
    }
    return iface.encodeFunctionData(fragment, args);
  } catch {
    return undefined;
  }
}

function extractOpenSeaFulfillmentTransaction(payload: Record<string, unknown>) {
  const fulfillmentData =
    payload.fulfillment_data && typeof payload.fulfillment_data === "object"
      ? (payload.fulfillment_data as Record<string, unknown>)
      : payload.fulfillmentData && typeof payload.fulfillmentData === "object"
        ? (payload.fulfillmentData as Record<string, unknown>)
        : undefined;
  const nestedFulfillmentData =
    fulfillmentData?.fulfillment_data &&
    typeof fulfillmentData.fulfillment_data === "object"
      ? (fulfillmentData.fulfillment_data as Record<string, unknown>)
      : fulfillmentData?.fulfillmentData &&
          typeof fulfillmentData.fulfillmentData === "object"
        ? (fulfillmentData.fulfillmentData as Record<string, unknown>)
        : undefined;
  const candidateTransactions = [
    payload.transaction,
    fulfillmentData?.transaction,
    nestedFulfillmentData?.transaction,
    fulfillmentData?.tx,
    nestedFulfillmentData?.tx,
  ];
  return candidateTransactions.find(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate && typeof candidate === "object"),
  );
}

function parseOpenSeaFulfillmentResponse(payload: unknown): ApiOpenSeaFulfillmentResponse | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const rawTransaction = extractOpenSeaFulfillmentTransaction(record);
  if (!rawTransaction) {
    return undefined;
  }
  const normalizedTransactionValue = normalizeOpenSeaAbiArg(rawTransaction);
  const transaction =
    normalizedTransactionValue &&
    typeof normalizedTransactionValue === "object" &&
    !Array.isArray(normalizedTransactionValue)
      ? (normalizedTransactionValue as Record<string, unknown>)
      : rawTransaction;
  const to = typeof transaction.to === "string" ? transaction.to : undefined;
  const data =
    extractOpenSeaTxInputHex(transaction) ??
    encodeOpenSeaStructuredInputData(transaction);
  const normalizedValue = normalizeOpenSeaAbiArg(transaction.value);
  const value = parseNumberishString(normalizedValue) ?? "0";
  const from = typeof transaction.from === "string" ? transaction.from : undefined;
  if (!to || !data) {
    return undefined;
  }
  return {
    to: toLowerAddress(to),
    from: from ? toLowerAddress(from) : undefined,
    value,
    data,
  };
}

function parseOpenSeaCreateListingResponse(payload: unknown): ApiOpenSeaCreateListingResponse {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const topLevelOrderHash =
    typeof record.order_hash === "string"
      ? record.order_hash
      : typeof record.orderHash === "string"
        ? record.orderHash
        : undefined;
  const orderRecord =
    record.order && typeof record.order === "object"
      ? (record.order as Record<string, unknown>)
      : undefined;
  const nestedOrderHash =
    typeof orderRecord?.order_hash === "string"
      ? orderRecord.order_hash
      : typeof orderRecord?.orderHash === "string"
        ? orderRecord.orderHash
        : undefined;
  const orderHash = topLevelOrderHash ?? nestedOrderHash;
  if (!orderHash) {
    return {};
  }
  return { orderHash };
}

function parseOpenSeaNftCollectionSlug(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  const nft =
    root.nft && typeof root.nft === "object"
      ? (root.nft as Record<string, unknown>)
      : undefined;
  const collectionValue = nft?.collection ?? root.collection;
  if (typeof collectionValue === "string" && collectionValue.trim().length > 0) {
    return collectionValue.trim();
  }
  if (collectionValue && typeof collectionValue === "object") {
    const collectionRecord = collectionValue as Record<string, unknown>;
    const slug =
      typeof collectionRecord.slug === "string"
        ? collectionRecord.slug
        : typeof collectionRecord.collection === "string"
          ? collectionRecord.collection
          : undefined;
    if (slug && slug.trim().length > 0) {
      return slug.trim();
    }
  }
  return undefined;
}

function normalizeOpenSeaFeeBps(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  // OpenSea docs surface fees inconsistently as percent-style decimals (e.g. 1.0)
  // and sometimes as basis points; this handles both representations.
  const bps = numeric > 10 ? numeric : numeric * 100;
  const normalized = Math.round(bps);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function parseOpenSeaCollectionRequiredFees(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { collection: undefined, fees: [] } as ApiOpenSeaRequiredFeesResponse;
  }
  const root = payload as Record<string, unknown>;
  const collection =
    typeof root.collection === "string"
      ? root.collection
      : typeof root.name === "string"
        ? root.name
        : undefined;
  const rawFees = Array.isArray(root.fees) ? root.fees : [];
  const deduped = new Map<string, { recipient: string; basisPoints: number }>();
  for (const item of rawFees) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const feeRecord = item as Record<string, unknown>;
    if (feeRecord.required !== true) {
      continue;
    }
    if (typeof feeRecord.recipient !== "string") {
      continue;
    }
    const recipient = toLowerAddress(feeRecord.recipient);
    const basisPoints = normalizeOpenSeaFeeBps(feeRecord.fee);
    if (!basisPoints) {
      continue;
    }
    const previous = deduped.get(recipient);
    if (!previous || basisPoints > previous.basisPoints) {
      deduped.set(recipient, { recipient, basisPoints });
    }
  }
  return {
    collection,
    fees: [...deduped.values()],
  } satisfies ApiOpenSeaRequiredFeesResponse;
}

function parseAlchemyTokenAsset(raw: unknown): PortfolioAsset | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const chain = alchemyNetworkToChainSlug(record.network);
  if (!chain) {
    return undefined;
  }

  const tokenMetadata =
    record.tokenMetadata && typeof record.tokenMetadata === "object"
      ? (record.tokenMetadata as Record<string, unknown>)
      : undefined;
  const tokenBalance = typeof record.tokenBalance === "string" ? record.tokenBalance : undefined;
  if (!tokenBalance) {
    return undefined;
  }

  const decimalsRaw = tokenMetadata?.decimals;
  const decimals =
    typeof decimalsRaw === "number"
      ? decimalsRaw
      : typeof decimalsRaw === "string"
        ? Number.parseInt(decimalsRaw, 10)
        : 18;
  if (!Number.isFinite(decimals) || decimals < 0) {
    return undefined;
  }

  let balance: string;
  try {
    balance = formatUnits(BigInt(tokenBalance), decimals);
  } catch {
    return undefined;
  }

  if (Number(balance) <= 0) {
    return undefined;
  }

  const tokenAddress = typeof record.tokenAddress === "string" ? record.tokenAddress : undefined;
  const isNative = !tokenAddress || tokenAddress === "native";

  let address: string | "native";
  if (isNative) {
    address = "native";
  } else {
    try {
      address = getAddress(tokenAddress);
    } catch {
      return undefined;
    }
  }

  const symbol = typeof tokenMetadata?.symbol === "string" ? tokenMetadata.symbol : isNative ? "ETH" : "TOKEN";
  const name = typeof tokenMetadata?.name === "string" ? tokenMetadata.name : symbol;
  const logoUrl = typeof tokenMetadata?.logo === "string" ? tokenMetadata.logo : undefined;

  return {
    chain,
    address,
    symbol,
    name,
    balance,
    decimals,
    usdValue: 0,
    logoUrl,
    verified: true,
  };
}

type AlchemyByAddressResponse = {
  tokens?: unknown[];
  tokenBalances?: unknown[];
  data?: {
    tokens?: unknown[];
    tokenBalances?: unknown[];
    pageKey?: string;
  };
  pageKey?: string;
};

function extractAlchemyTokenRows(payload: AlchemyByAddressResponse): unknown[] {
  if (Array.isArray(payload.data?.tokens)) {
    return payload.data.tokens;
  }

  if (Array.isArray(payload.tokens)) {
    return payload.tokens;
  }

  if (Array.isArray(payload.data?.tokenBalances)) {
    return payload.data.tokenBalances;
  }

  if (Array.isArray(payload.tokenBalances)) {
    const normalized: unknown[] = [];
    for (const entry of payload.tokenBalances) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const row = entry as Record<string, unknown>;
      const network = row.network;
      const address = row.address;
      const balances = Array.isArray(row.tokenBalances) ? row.tokenBalances : [];

      for (const tokenBalance of balances) {
        if (!tokenBalance || typeof tokenBalance !== "object") {
          continue;
        }

        const tokenRecord = tokenBalance as Record<string, unknown>;
        const contract =
          tokenRecord.contract && typeof tokenRecord.contract === "object"
            ? (tokenRecord.contract as Record<string, unknown>)
            : undefined;

        normalized.push({
          network,
          address,
          tokenAddress: contract?.address,
          tokenBalance: tokenRecord.value,
          tokenMetadata: {
            name: contract?.name,
            symbol: contract?.symbol,
            decimals: contract?.decimals,
          },
        });
      }

      const nativeBalance =
        row.nativeBalance && typeof row.nativeBalance === "object"
          ? (row.nativeBalance as Record<string, unknown>)
          : undefined;
      if (typeof nativeBalance?.value === "string") {
        normalized.push({
          network,
          address,
          tokenAddress: "native",
          tokenBalance: nativeBalance.value,
          tokenMetadata: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
        });
      }
    }

    return normalized;
  }

  return [];
}

export function createApiDataService(rawEnv: ApiDataEnv): ApiDataService {
  const env = rawEnv;
  const runtimeAddressOverrides = createRuntimeAddressOverrides(env);
  const activeProfile = resolveRuntimeProfile(getEnvString(env, "CRYPTO_WORLD_PROFILE"));
  const runtimeConfig = getRuntimeProtocolConfig(activeProfile, runtimeAddressOverrides);
  const runtimeConfigByProfile: Record<RuntimeProfile, ReturnType<typeof getRuntimeProtocolConfig>> = {
    testnet: getRuntimeProtocolConfig("testnet", runtimeAddressOverrides),
    mainnet: getRuntimeProtocolConfig("mainnet", runtimeAddressOverrides),
  };
  const publicClientsByProfile = createPublicClients(env);
  const tokenMetadata = buildTokenMetadata(runtimeConfigByProfile);
  const openSeaApiKey = getEnvString(env, "OPENSEA_API_KEY");
  const openSeaProtocolAddressByChain: Record<ChainSlug, string> = {
    ethereum: resolveOpenSeaProtocolAddress(env, "ethereum"),
    base: resolveOpenSeaProtocolAddress(env, "base"),
    polygon: resolveOpenSeaProtocolAddress(env, "polygon"),
  };
  const alchemyNftApiKey =
    getEnvString(env, "ALCHEMY_NFT_API_KEY") ??
    getEnvString(env, "ALCHEMY_DATA_API_KEY");
  let loggedMissingAlchemyKey = false;
  let loggedMissingOpenSeaKey = false;

  function getPublicClient(profile: RuntimeProfile, chain: ChainSlug) {
    return publicClientsByProfile[profile][chain];
  }

  async function requestOpenSea(path: string, init?: RequestInit) {
    if (!openSeaApiKey) {
      if (!loggedMissingOpenSeaKey) {
        loggedMissingOpenSeaKey = true;
        console.warn("[market] OPENSEA_API_KEY is not set; OpenSea endpoints will return empty results.");
      }
      throw new Error("OpenSea API key is not configured");
    }

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-API-KEY", openSeaApiKey);

    const response = await fetch(`${OPENSEA_API_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new OpenSeaRequestError(response.status, body);
    }

    return (await response.json()) as unknown;
  }

  async function requestAlchemyNfts(
    path: string,
    chain: ChainSlug,
    profile: RuntimeProfile,
    init?: RequestInit,
  ) {
    if (!alchemyNftApiKey) {
      return undefined;
    }
    const network = alchemyNftNetworkName(chain, profile);
    const base = ALCHEMY_NFT_API_BASE.replace("%NETWORK%", network);
    const response = await fetch(`${base}/${alchemyNftApiKey}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as unknown;
  }

  async function listAlchemyTokenAssets(address: string): Promise<PortfolioAsset[]> {
    const apiKey = getEnvString(env, "ALCHEMY_DATA_API_KEY");
    if (!apiKey) {
      if (!loggedMissingAlchemyKey) {
        loggedMissingAlchemyKey = true;
        console.warn("[portfolio] ALCHEMY_DATA_API_KEY is not set; skipping Alchemy token discovery.");
      }
      return [];
    }

    const assets: PortfolioAsset[] = [];
    for (const path of ALCHEMY_ENDPOINT_PATHS) {
      const endpoint = `https://api.g.alchemy.com/data/v1/${apiKey}/${path}`;
      let pageKey: string | undefined;

      for (let page = 0; page < 10; page += 1) {
        const requestBody = {
          addresses: [{ address, networks: alchemyDiscoveryNetworks }],
          includeErc20Tokens: true,
          includeNativeTokens: true,
          withMetadata: true,
          ...(pageKey ? { pageKey } : {}),
        };

        let payload: AlchemyByAddressResponse;
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(6_000),
          });

          if (!response.ok) {
            console.warn(`[portfolio] Alchemy request failed (${path}) status=${response.status}`);
            break;
          }

          payload = (await response.json()) as AlchemyByAddressResponse;
        } catch {
          break;
        }

        const tokenRows = extractAlchemyTokenRows(payload);
        for (const token of tokenRows) {
          const asset = parseAlchemyTokenAsset(token);
          if (asset) {
            assets.push(asset);
          }
        }

        const nextPageKey =
          typeof payload.data?.pageKey === "string"
            ? payload.data.pageKey
            : typeof payload.pageKey === "string"
              ? payload.pageKey
              : undefined;
        if (!nextPageKey) {
          break;
        }

        pageKey = nextPageKey;
      }

      if (assets.length > 0) {
        return dedupeAssets(assets);
      }
    }

    return dedupeAssets(assets);
  }

  async function readNativeAsset(
    chain: ChainSlug,
    address: string,
    profile: RuntimeProfile,
  ): Promise<PortfolioAsset | null> {
    const client = getPublicClient(profile, chain);
    const balance = await withTimeout(
      client.getBalance({ address: getAddress(address) }),
      RPC_READ_TIMEOUT_MS,
      `getBalance(${chain})`,
    );

    if (balance <= 0n) {
      return null;
    }

    return {
      ...nativeAssetMeta[chain],
      balance: formatUnits(balance, 18),
      usdValue: 0,
    };
  }

  async function readTokenAsset(
    chain: ChainSlug,
    holderAddress: string,
    tokenAddress: string,
    profile: RuntimeProfile,
  ): Promise<PortfolioAsset | null> {
    const client = getPublicClient(profile, chain);
    const [balance, decimals, symbol, name] = await withTimeout(
      Promise.all([
        client.readContract({
          address: getAddress(tokenAddress),
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [getAddress(holderAddress)],
        }),
        client.readContract({
          address: getAddress(tokenAddress),
          abi: erc20Abi,
          functionName: "decimals",
        }),
        client.readContract({
          address: getAddress(tokenAddress),
          abi: erc20Abi,
          functionName: "symbol",
        }),
        client.readContract({
          address: getAddress(tokenAddress),
          abi: erc20Abi,
          functionName: "name",
        }),
      ]),
      RPC_READ_TIMEOUT_MS,
      `readTokenAsset(${chain},${tokenAddress})`,
    );

    if (balance <= 0n) {
      return null;
    }

    const metadata = tokenMetadata.get(`${chain}:${tokenAddress}`.toLowerCase());

    return {
      chain,
      address: getAddress(tokenAddress),
      symbol: metadata?.symbol ?? symbol,
      name: metadata?.name ?? name,
      balance: formatUnits(balance, Number(metadata?.decimals ?? decimals)),
      decimals: Number(metadata?.decimals ?? decimals),
      usdValue: 0,
      verified: metadata?.verified ?? true,
    };
  }

  async function listPortfolioForProfile(
    address: string,
    profile: RuntimeProfile,
    includeAlchemyDiscovery = true,
  ): Promise<PortfolioAsset[]> {
    const checksumAddress = getAddress(address);
    const supportedTokens = uniqueSupportedTokens(runtimeConfigByProfile[profile].protocolRegistry);
    const supportedAssetResults = await Promise.allSettled(
      supportedTokens.map(async (token) => {
        if (token.address === "native") {
          return await readNativeAsset(token.chain, checksumAddress, profile);
        }

        return await readTokenAsset(token.chain, checksumAddress, token.address, profile);
      }),
    );
    const supportedAssets = supportedAssetResults.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    const alchemyAssets = includeAlchemyDiscovery
      ? await listAlchemyTokenAssets(checksumAddress)
      : [];

    return dedupeAssets([...supportedAssets, ...alchemyAssets]);
  }

  async function listPortfolio(address: string): Promise<PortfolioAsset[]> {
    try {
      return await withTimeout(
        listPortfolioForProfile(address, activeProfile, true),
        PORTFOLIO_PROFILE_TIMEOUT_MS,
        `listPortfolioForProfile(${activeProfile})`,
      );
    } catch {
      return [];
    }
  }

  function listProtocolRegistry() {
    return runtimeConfig.protocolRegistry;
  }

  async function listWalletNfts(address: string, chain: ChainSlug, cursor?: string) {
    const checksumAddress = getAddress(address);

    if (openSeaApiKey) {
      try {
        const params = new URLSearchParams();
        if (cursor) {
          params.set("next", cursor);
        }
        params.set("limit", "200");
        const query = params.toString();
        const payload = await requestOpenSea(
          `/chain/${openSeaChainName(chain)}/account/${checksumAddress}/nfts${query ? `?${query}` : ""}`,
          { method: "GET" },
        );
        const parsed = parseOpenSeaNftsResponse(payload);
        if (parsed.nfts.length > 0 || parsed.nextCursor || cursor) {
          return parsed;
        }
      } catch {
        // Fallback to Alchemy ownership index when OpenSea is unavailable or stale.
      }
    }

    const alchemyParams = new URLSearchParams();
    alchemyParams.set("owner", checksumAddress);
    alchemyParams.set("withMetadata", "true");
    alchemyParams.set("pageSize", "100");
    if (cursor) {
      alchemyParams.set("pageKey", cursor);
    }
    const alchemyPayload = await requestAlchemyNfts(
      `/getNFTsForOwner?${alchemyParams.toString()}`,
      chain,
      activeProfile,
      { method: "GET" },
    );
    if (!alchemyPayload) {
      return { nfts: [] } satisfies ApiWalletNftResponse;
    }
    const parsedAlchemy = parseAlchemyNftsResponse(alchemyPayload);
    return {
      nfts: dedupeWalletNfts(parsedAlchemy.nfts),
      nextCursor: parsedAlchemy.nextCursor,
    };
  }

  async function getOpenSeaRequiredFees(request: ApiOpenSeaRequiredFeesRequest) {
    const defaultFees: ApiOpenSeaRequiredFeesResponse = {
      fees: [
        {
          recipient: toLowerAddress(DEFAULT_OPENSEA_FEE_RECIPIENT),
          basisPoints: 100,
        },
      ],
    };
    if (!openSeaApiKey) {
      return defaultFees;
    }
    try {
      const checksumContract = getAddress(request.nftContract);
      const tokenId = request.tokenId;
      const nftPayload = await requestOpenSea(
        `/chain/${openSeaChainName(request.chain)}/contract/${checksumContract}/nfts/${encodeURIComponent(tokenId)}`,
        { method: "GET" },
      );
      const collectionSlug = parseOpenSeaNftCollectionSlug(nftPayload);
      if (!collectionSlug) {
        return defaultFees;
      }

      const collectionPayload = await requestOpenSea(
        `/collections/${encodeURIComponent(collectionSlug)}`,
        { method: "GET" },
      );
      const parsed = parseOpenSeaCollectionRequiredFees(collectionPayload);
      if (parsed.fees.length === 0) {
        return {
          collection: parsed.collection ?? collectionSlug,
          fees: defaultFees.fees,
        } satisfies ApiOpenSeaRequiredFeesResponse;
      }
      return parsed;
    } catch {
      // Fee lookup should not block listing flow; posting endpoint will still
      // validate and return explicit fee requirements if this fallback is insufficient.
      return defaultFees;
    }
  }

  async function createOpenSeaListing(request: ApiOpenSeaCreateListingRequest) {
    if (!openSeaApiKey) {
      throw new Error("OpenSea API key is not configured");
    }
    if (activeProfile !== "mainnet") {
      throw new Error(
        "OpenSea listing publish is only enabled for mainnet profile. Set CRYPTO_WORLD_PROFILE=mainnet and redeploy API/Party/Web.",
      );
    }
    const payload = await requestOpenSea(
      `/orders/${openSeaChainName(request.chain)}/seaport/listings`,
      {
        method: "POST",
        body: JSON.stringify({
          protocol_address: openSeaProtocolAddressByChain[request.chain],
          parameters: request.order.parameters,
          signature: request.order.signature,
        }),
      },
    );
    return parseOpenSeaCreateListingResponse(payload);
  }

  async function listOpenSeaListings(address: string, chain: ChainSlug, limit = 20) {
    if (!openSeaApiKey) {
      return { listings: [] } satisfies ApiOpenSeaListingsResponse;
    }
    const checksumAddress = getAddress(address);
    const chainName = openSeaChainName(chain);
    const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    try {
      const payload = await requestOpenSea(
        `/orders/${chainName}/seaport/listings?maker=${checksumAddress}&limit=${cappedLimit}`,
        { method: "GET" },
      );
      return parseOpenSeaListingsResponse(payload, chain);
    } catch (primaryError) {
      if (isOpenSeaRateLimitError(primaryError)) {
        return { listings: [] } satisfies ApiOpenSeaListingsResponse;
      }
      // OpenSea orderbook routes can differ by account capability/profile.
      // Fallback to account events so sellers can still hydrate baseline listings.
      try {
        const payload = await requestOpenSea(
          `/events/accounts/${checksumAddress}?chain=${chainName}&event_type=order&limit=${cappedLimit}`,
          { method: "GET" },
        );
        return parseOpenSeaListingsResponse(payload, chain);
      } catch (fallbackError) {
        if (!isOpenSeaRateLimitError(fallbackError)) {
          console.warn(
            `[market] OpenSea listings unavailable for ${checksumAddress} on ${chainName}; returning empty list.`,
          );
        }
        return { listings: [] } satisfies ApiOpenSeaListingsResponse;
      }
    }
  }

  async function buildOpenSeaFulfillment(request: ApiOpenSeaFulfillmentRequest) {
    if (!openSeaApiKey) {
      throw new Error("OpenSea API key is not configured");
    }
    const checksumFulfiller = getAddress(request.fulfiller);
    const protocolAddress = request.protocolAddress
      ? getAddress(request.protocolAddress)
      : openSeaProtocolAddressByChain[request.chain];
    const consideration =
      request.nftContract && request.tokenId
        ? {
            asset_contract_address: getAddress(request.nftContract),
            token_id: request.tokenId,
          }
        : undefined;
    const payload = await requestOpenSea("/listings/fulfillment_data", {
      method: "POST",
      body: JSON.stringify({
        listing: {
          hash: request.orderHash,
          chain: openSeaChainName(request.chain),
          protocol_address: protocolAddress,
        },
        fulfiller: {
          address: checksumFulfiller,
        },
        ...(consideration ? { consideration } : {}),
      }),
    });
    const fulfillment = parseOpenSeaFulfillmentResponse(payload);
    if (!fulfillment) {
      const payloadRecord =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : undefined;
      const transactionRecord = payloadRecord
        ? extractOpenSeaFulfillmentTransaction(payloadRecord)
        : undefined;
      const topLevelKeys = payloadRecord
        ? Object.keys(payloadRecord).slice(0, 8).join(",")
        : "none";
      const transactionKeys = transactionRecord
        ? Object.keys(transactionRecord).slice(0, 12).join(",")
        : "none";
      const transactionInputData =
        transactionRecord &&
        transactionRecord.input_data &&
        typeof transactionRecord.input_data === "object"
          ? (transactionRecord.input_data as Record<string, unknown>)
          : transactionRecord &&
              transactionRecord.inputData &&
              typeof transactionRecord.inputData === "object"
            ? (transactionRecord.inputData as Record<string, unknown>)
            : undefined;
      const inputDataKeys = transactionInputData
        ? Object.keys(transactionInputData).slice(0, 12).join(",")
        : "none";
      throw new Error(
        `OpenSea fulfillment payload missing transaction call data (payload keys: ${topLevelKeys}; transaction keys: ${transactionKeys}; input_data keys: ${inputDataKeys})`,
      );
    }
    return fulfillment;
  }

  return {
    listPortfolio,
    listProtocolRegistry,
    listWalletNfts,
    getOpenSeaRequiredFees,
    createOpenSeaListing,
    listOpenSeaListings,
    buildOpenSeaFulfillment,
  };
}

function resolveDefaultEnv() {
  if (typeof process !== "undefined" && process?.env) {
    return process.env as ApiDataEnv;
  }

  return {};
}

const defaultService = createApiDataService(resolveDefaultEnv());

export const listPortfolio = defaultService.listPortfolio;
export const listProtocolRegistry = defaultService.listProtocolRegistry;
export const listWalletNfts = defaultService.listWalletNfts;
export const getOpenSeaRequiredFees = defaultService.getOpenSeaRequiredFees;
export const createOpenSeaListing = defaultService.createOpenSeaListing;
export const listOpenSeaListings = defaultService.listOpenSeaListings;
export const buildOpenSeaFulfillment = defaultService.buildOpenSeaFulfillment;
