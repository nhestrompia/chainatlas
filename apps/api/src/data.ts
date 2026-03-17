import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
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
};

export type ApiWalletNftResponse = {
  nfts: ApiWalletNft[];
  nextCursor?: string;
};

export type ApiOpenSeaListingsResponse = {
  listings: MerchantListing[];
};

export type ApiOpenSeaFulfillmentRequest = {
  chain: ChainSlug;
  orderHash: string;
  protocolAddress?: string;
  fulfiller: string;
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

  return profile === "testnet" ? baseSepolia : base;
}

function resolveRpcUrl(env: ApiDataEnv, slug: ChainSlug, profile: RuntimeProfile) {
  if (slug === "ethereum") {
    if (profile === "testnet") {
      return getEnvString(env, "SEPOLIA_RPC_URL") ?? getEnvString(env, "ETHEREUM_RPC_URL");
    }

    return getEnvString(env, "ETHEREUM_RPC_URL");
  }

  if (profile === "testnet") {
    return getEnvString(env, "BASE_SEPOLIA_RPC_URL") ?? getEnvString(env, "BASE_RPC_URL");
  }

  return getEnvString(env, "BASE_RPC_URL");
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
    wrappedNativeEthereum: optionalAddressEnv(env, "WRAPPED_NATIVE_ETHEREUM", "VITE_WRAPPED_NATIVE_ETHEREUM"),
    wrappedNativeBase: optionalAddressEnv(env, "WRAPPED_NATIVE_BASE", "VITE_WRAPPED_NATIVE_BASE"),
    usdcEthereum: optionalAddressEnv(env, "USDC_ETHEREUM", "VITE_USDC_ETHEREUM"),
    usdcBase: optionalAddressEnv(env, "USDC_BASE", "VITE_USDC_BASE"),
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
  return chain === "ethereum" ? "ethereum" : "base";
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
    const imageUrl =
      typeof nft.image_url === "string"
        ? nft.image_url
        : typeof nft.image_original_url === "string"
          ? nft.image_original_url
          : undefined;
    return [
      {
        contractAddress: toLowerAddress(contractAddress),
        tokenId,
        collectionName: collectionName ?? "Collection",
        tokenName,
        imageUrl,
      } satisfies ApiWalletNft,
    ];
  });
  const nextCursor = typeof record.next === "string" ? record.next : undefined;
  return { nfts, nextCursor };
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
    const consideration = Array.isArray(parameters?.consideration)
      ? (parameters?.consideration as Array<Record<string, unknown>>)
      : [];
    const offer = Array.isArray(parameters?.offer)
      ? (parameters?.offer as Array<Record<string, unknown>>)
      : [];
    const nftOffer = offer.find((itemOffer) => {
      const itemType = Number(itemOffer.itemType ?? itemOffer.item_type);
      return itemType === 2 || itemType === 3;
    });
    const payment = consideration.find((itemConsideration) => {
      const itemType = Number(itemConsideration.itemType ?? itemConsideration.item_type);
      return itemType === 0;
    });
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
    const startAmount = parseNumberishString(
      payment?.startAmount ??
        payment?.start_amount ??
        entry.current_price ??
        priceRecord?.value,
    );
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
    const imageUrl =
      typeof entry.image_url === "string"
        ? entry.image_url
        : entry.asset && typeof entry.asset === "object"
          ? ((entry.asset as Record<string, unknown>).image_url as string | undefined)
          : undefined;
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
      } satisfies MerchantListing,
    ];
  });
  return { listings };
}

function parseOpenSeaFulfillmentResponse(payload: unknown): ApiOpenSeaFulfillmentResponse | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const tx =
    record.fulfillment_data && typeof record.fulfillment_data === "object"
      ? (record.fulfillment_data as Record<string, unknown>).transaction
      : record.transaction;
  if (!tx || typeof tx !== "object") {
    return undefined;
  }
  const transaction = tx as Record<string, unknown>;
  const to = typeof transaction.to === "string" ? transaction.to : undefined;
  const data = typeof transaction.data === "string" ? transaction.data : undefined;
  const value = parseNumberishString(transaction.value) ?? "0";
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
    if (!openSeaApiKey) {
      return { nfts: [] } satisfies ApiWalletNftResponse;
    }
    const checksumAddress = getAddress(address);
    const params = new URLSearchParams();
    if (cursor) {
      params.set("next", cursor);
    }
    params.set("limit", "50");
    const query = params.toString();
    const payload = await requestOpenSea(
      `/chain/${openSeaChainName(chain)}/account/${checksumAddress}/nfts${query ? `?${query}` : ""}`,
      { method: "GET" },
    );
    return parseOpenSeaNftsResponse(payload);
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
    const payload = await requestOpenSea("/listings/fulfillment_data", {
      method: "POST",
      body: JSON.stringify({
        listing: {
          hash: request.orderHash,
          chain: openSeaChainName(request.chain),
          ...(request.protocolAddress ? { protocol_address: request.protocolAddress } : {}),
        },
        fulfiller: {
          address: checksumFulfiller,
        },
      }),
    });
    const fulfillment = parseOpenSeaFulfillmentResponse(payload);
    if (!fulfillment) {
      throw new Error("OpenSea fulfillment payload missing transaction call data");
    }
    return fulfillment;
  }

  return {
    listPortfolio,
    listProtocolRegistry,
    listWalletNfts,
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
export const listOpenSeaListings = defaultService.listOpenSeaListings;
export const buildOpenSeaFulfillment = defaultService.buildOpenSeaFulfillment;
