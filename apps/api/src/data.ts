import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { base, baseSepolia, mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";
import {
  getRuntimeProtocolConfig,
  resolveRuntimeProfile,
  type ChainSlug,
  type PortfolioAsset,
  type ProtocolRegistryEntry,
  type RuntimeAddressOverrides,
  type RuntimeProfile,
} from "@chainatlas/shared";

export type ApiDataEnv = Record<string, unknown>;

export type ApiDataService = {
  listPortfolio: (address: string) => Promise<PortfolioAsset[]>;
  listProtocolRegistry: () => ProtocolRegistryEntry[];
};

const alchemyDiscoveryNetworks = ["eth-mainnet", "base-mainnet", "eth-sepolia", "base-sepolia"] as const;
const PORTFOLIO_PROFILE_TIMEOUT_MS = 8_000;
const RPC_READ_TIMEOUT_MS = 4_000;
const ALCHEMY_ENDPOINT_PATHS = ["assets/tokens/by-address", "assets/tokens/balances/by-address"] as const;

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
  let loggedMissingAlchemyKey = false;

  function getPublicClient(profile: RuntimeProfile, chain: ChainSlug) {
    return publicClientsByProfile[profile][chain];
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

  return {
    listPortfolio,
    listProtocolRegistry,
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
