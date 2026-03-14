import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
import {
  getRuntimeProtocolConfig,
  resolveRuntimeProfile,
  type BridgeJob,
  type ChainSlug,
  type PortfolioAsset,
  type ProtocolRegistryEntry,
  type RuntimeProfile,
} from "@cryptoworld/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const envPath of [
  undefined,
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../../.env"),
]) {
  try {
    process.loadEnvFile?.(envPath);
  } catch {
    // Tests and deployed environments can still provide variables via process.env.
  }
}

const bridgeJobStorePath = path.resolve(
  process.cwd(),
  process.env.BRIDGE_JOB_STORE_PATH ?? path.join(__dirname, "../data/bridge-jobs.json"),
);

const activeProfile = resolveRuntimeProfile(process.env.CRYPTO_WORLD_PROFILE);
const runtimeConfig = getRuntimeProtocolConfig(activeProfile);
const runtimeConfigByProfile = {
  testnet: getRuntimeProtocolConfig("testnet"),
  mainnet: getRuntimeProtocolConfig("mainnet"),
} as const;

const alchemyDiscoveryNetworks = ["eth-mainnet", "base-mainnet", "eth-sepolia", "base-sepolia"] as const;
let loggedMissingAlchemyKey = false;
const PORTFOLIO_PROFILE_TIMEOUT_MS = 8_000;
const RPC_READ_TIMEOUT_MS = 4_000;
const ALCHEMY_ENDPOINT_PATHS = ["assets/tokens/by-address", "assets/tokens/balances/by-address"] as const;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function resolveChain(slug: ChainSlug, profile: RuntimeProfile) {
  if (slug === "ethereum") {
    return profile === "testnet" ? sepolia : mainnet;
  }
  return profile === "testnet" ? baseSepolia : base;
}

function resolveRpcUrl(slug: ChainSlug, profile: RuntimeProfile) {
  if (slug === "ethereum") {
    if (profile === "testnet") {
      return process.env.SEPOLIA_RPC_URL ?? process.env.ETHEREUM_RPC_URL;
    }
    return process.env.ETHEREUM_RPC_URL;
  }

  if (profile === "testnet") {
    return process.env.BASE_SEPOLIA_RPC_URL ?? process.env.BASE_RPC_URL;
  }
  return process.env.BASE_RPC_URL;
}

const publicClientsByProfile = {
  testnet: {
    ethereum: createPublicClient({
      chain: resolveChain("ethereum", "testnet"),
      transport: http(
        resolveRpcUrl("ethereum", "testnet") ?? resolveChain("ethereum", "testnet").rpcUrls.default.http[0],
      ),
    }),
    base: createPublicClient({
      chain: resolveChain("base", "testnet"),
      transport: http(resolveRpcUrl("base", "testnet") ?? resolveChain("base", "testnet").rpcUrls.default.http[0]),
    }),
  },
  mainnet: {
    ethereum: createPublicClient({
      chain: resolveChain("ethereum", "mainnet"),
      transport: http(
        resolveRpcUrl("ethereum", "mainnet") ?? resolveChain("ethereum", "mainnet").rpcUrls.default.http[0],
      ),
    }),
    base: createPublicClient({
      chain: resolveChain("base", "mainnet"),
      transport: http(resolveRpcUrl("base", "mainnet") ?? resolveChain("base", "mainnet").rpcUrls.default.http[0]),
    }),
  },
} as const;

function getPublicClient(profile: RuntimeProfile, chain: ChainSlug) {
  return publicClientsByProfile[profile][chain];
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

const tokenMetadata = new Map<string, Pick<PortfolioAsset, "name" | "symbol" | "decimals" | "verified">>([
  [
    "ethereum:0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48".toLowerCase(),
    { name: "USD Coin", symbol: "USDC", decimals: 6, verified: true },
  ],
  [
    "base:0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
    { name: "USD Coin", symbol: "USDC", decimals: 6, verified: true },
  ],
  [
    "ethereum:0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238".toLowerCase(),
    { name: "USD Coin", symbol: "USDC", decimals: 6, verified: true },
  ],
  [
    "base:0x036CbD53842c5426634e7929541eC2318f3dCF7".toLowerCase(),
    { name: "USD Coin", symbol: "USDC", decimals: 6, verified: true },
  ],
]);

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
  const symbol =
    typeof tokenMetadata?.symbol === "string" ? tokenMetadata.symbol : isNative ? "ETH" : "TOKEN";
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
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const network = row.network;
      const address = row.address;
      const balances = Array.isArray(row.tokenBalances) ? row.tokenBalances : [];
      for (const tokenBalance of balances) {
        if (!tokenBalance || typeof tokenBalance !== "object") continue;
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

async function listAlchemyTokenAssets(
  address: string,
  _profile: RuntimeProfile,
): Promise<PortfolioAsset[]> {
  const apiKey = process.env.ALCHEMY_DATA_API_KEY;
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

async function ensureBridgeJobStore() {
  await mkdir(path.dirname(bridgeJobStorePath), { recursive: true });

  try {
    await readFile(bridgeJobStorePath, "utf8");
  } catch {
    await writeFile(bridgeJobStorePath, "[]", "utf8");
  }
}

async function readBridgeJobs(): Promise<BridgeJob[]> {
  await ensureBridgeJobStore();
  const raw = await readFile(bridgeJobStorePath, "utf8");
  const parsed = JSON.parse(raw) as BridgeJob[];
  return Array.isArray(parsed) ? parsed : [];
}

async function writeBridgeJobs(jobs: BridgeJob[]) {
  await ensureBridgeJobStore();
  await writeFile(bridgeJobStorePath, JSON.stringify(jobs, null, 2), "utf8");
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
    ? await listAlchemyTokenAssets(checksumAddress, profile)
    : [];

  return dedupeAssets([
    ...supportedAssets,
    ...alchemyAssets,
  ]);
}

export async function listPortfolio(address: string): Promise<PortfolioAsset[]> {
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

export function listProtocolRegistry() {
  return runtimeConfig.protocolRegistry;
}

export async function listBridgeJobs(address: string): Promise<BridgeJob[]> {
  const jobs = await readBridgeJobs();
  return jobs.filter((job) => job.address.toLowerCase() === address.toLowerCase());
}

export async function upsertBridgeJob(job: BridgeJob): Promise<BridgeJob> {
  const jobs = await readBridgeJobs();
  const index = jobs.findIndex((item) => item.id === job.id);

  if (index >= 0) {
    jobs[index] = job;
  } else {
    jobs.unshift(job);
  }

  await writeBridgeJobs(jobs);
  return job;
}

export async function updateBridgeJob(
  id: string,
  patch: Partial<BridgeJob>,
): Promise<BridgeJob | undefined> {
  const jobs = await readBridgeJobs();
  const match = jobs.find((job) => job.id === id);

  if (!match) {
    return undefined;
  }

  Object.assign(match, patch);
  match.updatedAt = new Date().toISOString();
  await writeBridgeJobs(jobs);
  return match;
}
