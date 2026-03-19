import type { ChainSlug } from "@chainatlas/shared";
import { toViemAccount, useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  getAddress,
  type WalletClient,
} from "viem";
import { base, baseSepolia, mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";
import { env } from "@/lib/config/env";
import { getChainIdForSlug, runtimeProfile } from "@/lib/config/runtime";
import { fetchWalletPortfolio, resolveChainSlug } from "./wallet-asset-portfolio";

const ensRpcUrl = env.ethereumRpcUrl.trim();
const ensClient = ensRpcUrl
  ? createPublicClient({
      chain: mainnet,
      transport: http(ensRpcUrl),
    })
  : undefined;
const PROVIDER_REQUEST_TIMEOUT_MS = 8_000;
const CHAIN_ID_REQUEST_TIMEOUT_MS = 2_500;
const CHAIN_SWITCH_TIMEOUT_MS = 25_000;
const ENSURE_CHAIN_TIMEOUT_MS = 18_000;
const CHAIN_CONFIRM_TIMEOUT_MS = 10_000;

function getRuntimeChain(slug: ChainSlug) {
  const chainId = getChainIdForSlug(slug);
  if (chainId === mainnet.id) return mainnet;
  if (chainId === base.id) return base;
  if (chainId === polygon.id) return polygon;
  if (chainId === sepolia.id) return sepolia;
  if (chainId === baseSepolia.id) return baseSepolia;
  if (chainId === polygonAmoy.id) return polygonAmoy;
  throw new Error(`Unsupported runtime chain for ${slug}`);
}

function resolveRpcUrl(slug: ChainSlug) {
  if (slug === "ethereum") {
    return runtimeProfile === "testnet"
      ? env.sepoliaRpcUrl || env.ethereumRpcUrl
      : env.ethereumRpcUrl;
  }
  if (slug === "base") {
    return runtimeProfile === "testnet"
      ? env.baseSepoliaRpcUrl || env.baseRpcUrl
      : env.baseRpcUrl;
  }
  return runtimeProfile === "testnet"
    ? env.polygonAmoyRpcUrl || env.polygonRpcUrl
    : env.polygonRpcUrl;
}

function resolveRpcCandidates(slug: ChainSlug) {
  const configured = resolveRpcUrl(slug);
  const fallbackUrls =
    slug === "ethereum"
      ? runtimeProfile === "testnet"
        ? ["https://ethereum-sepolia-rpc.publicnode.com", sepolia.rpcUrls.default.http[0]]
        : ["https://ethereum-rpc.publicnode.com", mainnet.rpcUrls.default.http[0]]
      : slug === "base"
        ? runtimeProfile === "testnet"
          ? ["https://base-sepolia-rpc.publicnode.com", baseSepolia.rpcUrls.default.http[0]]
          : ["https://base-rpc.publicnode.com", base.rpcUrls.default.http[0]]
        : runtimeProfile === "testnet"
          ? ["https://polygon-amoy-bor-rpc.publicnode.com", polygonAmoy.rpcUrls.default.http[0]]
          : ["https://polygon-bor-rpc.publicnode.com", polygon.rpcUrls.default.http[0]];

  return [...new Set([configured, ...fallbackUrls].map((url) => url?.trim()).filter(Boolean))];
}

function createChainTransport(slug: ChainSlug) {
  const urls = resolveRpcCandidates(slug);
  if (urls.length <= 1) {
    return http(urls[0]);
  }
  return fallback(urls.map((url) => http(url)));
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      const parsed = Number.parseInt(value, 16);
      return Number.isInteger(parsed) ? parsed : undefined;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Wallet request timed out (${label})`)), timeoutMs);
    }),
  ]);
}

type EthereumProviderLike = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(eventName: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(eventName: string, listener: (...args: unknown[]) => void): unknown;
};

function chainSlugFromChainId(chainId: number): ChainSlug | undefined {
  if (chainId === 1 || chainId === 11155111) {
    return "ethereum";
  }
  if (chainId === 8453 || chainId === 84532) {
    return "base";
  }
  if (chainId === 137 || chainId === 80002) {
    return "polygon";
  }
  return undefined;
}

function resolveChainFromProviderLike(provider: unknown): ChainSlug | undefined {
  if (!provider || typeof provider !== "object") {
    return undefined;
  }

  const record = provider as Record<string, unknown>;
  return resolveChainSlug(
    record.chainId ??
      record.chain ??
      record.network ??
      record.networkId ??
      record.networkVersion,
  );
}

function resolveChainFromWalletMetadata(wallet: unknown): ChainSlug | undefined {
  if (!wallet || typeof wallet !== "object") {
    return undefined;
  }

  const record = wallet as Record<string, unknown>;
  const candidates = [
    record.chainId,
    record.chain,
    record.network,
    record.networkId,
    record.currentChain,
    record.currentChainId,
    record.selectedChain,
    record.selectedNetwork,
    record.activeChain,
    record.activeNetwork,
    record.connector,
    record.provider,
    record.metadata,
    record.meta,
  ];

  for (const candidate of candidates) {
    const resolved = resolveChainSlug(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function resolveChainFromWindowProvider(): ChainSlug | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum;
  return resolveChainFromProviderLike(ethereum);
}

function inferWalletChain(
  wallet: unknown,
  provider?: unknown,
): ChainSlug | undefined {
  return (
    resolveChainFromProviderLike(provider) ??
    resolveChainFromWalletMetadata(wallet) ??
    resolveChainFromWindowProvider()
  );
}

function extractNumericChainId(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.startsWith("eip155:")) {
    return parseChainId(value.split(":")[1]);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractNumericChainId(record.chainId) ??
      extractNumericChainId(record.id) ??
      extractNumericChainId(record.chain) ??
      extractNumericChainId(record.networkId) ??
      extractNumericChainId(record.networkVersion)
    );
  }
  return parseChainId(value);
}

function inferWalletChainId(
  wallet: unknown,
  provider?: unknown,
): number | undefined {
  const providerRecord = provider && typeof provider === "object"
    ? (provider as Record<string, unknown>)
    : undefined;
  const walletRecord = wallet && typeof wallet === "object"
    ? (wallet as Record<string, unknown>)
    : undefined;
  const windowEthereum =
    typeof window !== "undefined"
      ? (window as unknown as { ethereum?: unknown }).ethereum
      : undefined;

  return (
    extractNumericChainId(providerRecord) ??
    extractNumericChainId(walletRecord) ??
    extractNumericChainId(windowEthereum)
  );
}

async function requestWithTimeout<T>(
  provider: EthereumProviderLike,
  args: { method: string; params?: unknown[] },
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return await withTimeout(provider.request(args) as Promise<T>, args.method, timeoutMs);
}

function isWalletRequestTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("wallet request timed out")
  );
}

async function readProviderChainId(
  provider: EthereumProviderLike,
  timeoutMs = CHAIN_ID_REQUEST_TIMEOUT_MS,
) {
  return parseChainId(
    await requestWithTimeout(provider, {
      method: "eth_chainId",
    }, timeoutMs),
  );
}

async function getWalletEthereumProvider(
  wallet: ConnectedPrivyWallet,
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
) {
  return await withTimeout(wallet.getEthereumProvider(), "wallet.getEthereumProvider", timeoutMs);
}

async function waitForWalletChainId(
  wallet: ConnectedPrivyWallet,
  targetChainId: number,
  timeoutMs = CHAIN_CONFIRM_TIMEOUT_MS,
  pollMs = 250,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // Re-read provider each pass because wallets can swap provider instances
      // after network switch and stale instances may never emit new chain IDs.
      const provider = await getWalletEthereumProvider(wallet, PROVIDER_REQUEST_TIMEOUT_MS);
      const chainId = await readProviderChainId(provider, CHAIN_ID_REQUEST_TIMEOUT_MS);
      if (chainId === targetChainId) {
        return;
      }
    } catch {
      // Keep retrying while wallet/provider state converges.
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }

  throw new Error(
    `Wallet did not confirm chain switch to ${targetChainId} in time. Reconnect wallet and retry.`,
  );
}

function isUserRejectedError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "number" ? record.code : undefined;
  if (code === 4001) {
    return true;
  }
  const message =
    (typeof record.message === "string" && record.message) ||
    (typeof record.details === "string" && record.details) ||
    "";
  return message.toLowerCase().includes("rejected");
}

function getAddEthereumChainParams(slug: ChainSlug) {
  const chain = getRuntimeChain(slug);
  const rpcUrl = resolveRpcUrl(slug) || chain.rpcUrls.default.http[0];
  const explorerUrl =
    slug === "ethereum"
      ? runtimeProfile === "testnet"
        ? "https://sepolia.etherscan.io"
        : "https://etherscan.io"
      : slug === "base"
        ? runtimeProfile === "testnet"
          ? "https://sepolia.basescan.org"
          : "https://basescan.org"
        : runtimeProfile === "testnet"
          ? "https://amoy.polygonscan.com"
          : "https://polygonscan.com";

  return {
    chainId: toHexChainId(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: rpcUrl ? [rpcUrl] : [],
    ...(explorerUrl ? { blockExplorerUrls: [explorerUrl] } : {}),
  };
}

function shouldAddChain(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code =
    (typeof record.code === "number" && record.code) ||
    (record.data &&
    typeof record.data === "object" &&
    typeof (record.data as Record<string, unknown>).originalError === "object" &&
    (record.data as Record<string, unknown>).originalError
      ? ((record.data as Record<string, unknown>).originalError as Record<string, unknown>).code
      : undefined);
  if (code === 4902) {
    return true;
  }
  const message =
    (typeof record.message === "string" && record.message) ||
    (typeof record.details === "string" && record.details) ||
    "";
  const lowered = message.toLowerCase();
  return lowered.includes("unrecognized chain") || lowered.includes("unknown chain");
}

export async function getConnectedWalletChain(wallet: ConnectedPrivyWallet): Promise<ChainSlug | undefined> {
  const state = await getConnectedWalletChainState(wallet);
  return state.chain;
}

export type ConnectedWalletChainState = {
  chain?: ChainSlug;
  chainId?: number;
  supported: boolean;
  resolved: boolean;
};

export async function getConnectedWalletChainState(
  wallet: ConnectedPrivyWallet,
): Promise<ConnectedWalletChainState> {
  let provider: EthereumProviderLike | undefined;
  try {
    provider = await getWalletEthereumProvider(wallet);
  } catch {
    const fallbackChain = inferWalletChain(wallet);
    const fallbackChainId = inferWalletChainId(wallet);
    if (fallbackChain) {
      return {
        chain: fallbackChain,
        chainId: fallbackChainId,
        supported: true,
        resolved: true,
      };
    }
    if (typeof fallbackChainId === "number") {
      return {
        chainId: fallbackChainId,
        supported: false,
        resolved: true,
      };
    }
    return { supported: false, resolved: false };
  }

  const providerChainId = inferWalletChainId(wallet, provider);
  if (typeof providerChainId === "number") {
    const providerChain = chainSlugFromChainId(providerChainId);
    if (providerChain) {
      return {
        chain: providerChain,
        chainId: providerChainId,
        supported: true,
        resolved: true,
      };
    }
    return {
      chainId: providerChainId,
      supported: false,
      resolved: true,
    };
  }

  try {
    const rpcChainId = await readProviderChainId(provider);
    if (typeof rpcChainId === "number") {
      const rpcChain = chainSlugFromChainId(rpcChainId);
      if (rpcChain) {
        return {
          chain: rpcChain,
          chainId: rpcChainId,
          supported: true,
          resolved: true,
        };
      }
      return {
        chainId: rpcChainId,
        supported: false,
        resolved: true,
      };
    }
  } catch {
    // continue into fallback inference
  }

  const inferredChain = inferWalletChain(wallet, provider);
  const inferredChainId = inferWalletChainId(wallet, provider);
  if (inferredChain) {
    return {
      chain: inferredChain,
      chainId: inferredChainId,
      supported: true,
      resolved: true,
    };
  }
  if (typeof inferredChainId === "number") {
    return {
      chainId: inferredChainId,
      supported: false,
      resolved: true,
    };
  }

  return { supported: false, resolved: false };
}

export async function ensureWalletChain(wallet: ConnectedPrivyWallet, chain: ChainSlug): Promise<void> {
  const targetChain = getRuntimeChain(chain);
  const targetChainId = targetChain.id;
  const switchKey = `${wallet.address?.toLowerCase() ?? "unknown"}:${targetChainId}:strict`;
  const inFlight = ensureWalletChainInFlight.get(switchKey);
  if (inFlight) {
    return await inFlight;
  }

  const operation = ensureWalletChainInternal(wallet, chain, targetChainId);
  const guardedOperation = withTimeout(
    operation,
    "ensureWalletChain",
    ENSURE_CHAIN_TIMEOUT_MS,
  ).finally(() => {
    ensureWalletChainInFlight.delete(switchKey);
  });

  ensureWalletChainInFlight.set(switchKey, guardedOperation);
  return await guardedOperation;
}

const ensureWalletChainInFlight = new Map<string, Promise<void>>();

type EnsureWalletChainOptions = {
  strict?: boolean;
};

export async function ensureWalletChainOptimistic(
  wallet: ConnectedPrivyWallet,
  chain: ChainSlug,
): Promise<void> {
  const targetChain = getRuntimeChain(chain);
  const targetChainId = targetChain.id;
  const switchKey = `${wallet.address?.toLowerCase() ?? "unknown"}:${targetChainId}:optimistic`;
  const inFlight = ensureWalletChainInFlight.get(switchKey);
  if (inFlight) {
    return await inFlight;
  }

  const operation = ensureWalletChainInternal(wallet, chain, targetChainId, {
    strict: false,
  });
  const guardedOperation = withTimeout(
    operation,
    "ensureWalletChain",
    ENSURE_CHAIN_TIMEOUT_MS,
  ).finally(() => {
    ensureWalletChainInFlight.delete(switchKey);
  });

  ensureWalletChainInFlight.set(switchKey, guardedOperation);
  return await guardedOperation;
}

async function ensureWalletChainInternal(
  wallet: ConnectedPrivyWallet,
  chain: ChainSlug,
  targetChainId: number,
  options: EnsureWalletChainOptions = { strict: true },
) {
  const strict = options.strict ?? true;
  let provider = await getWalletEthereumProvider(wallet);

  let currentChainId: number | undefined;
  try {
    currentChainId = await readProviderChainId(provider);
  } catch (error) {
    if (!isWalletRequestTimeoutError(error)) {
      throw error;
    }
    currentChainId = undefined;
  }

  if (currentChainId === targetChainId) {
    return;
  }

  if (currentChainId === undefined) {
    const inferredChain = inferWalletChain(wallet, provider);
    if (!strict) {
      if (inferredChain === chain) {
        return;
      }
      if (inferredChain) {
        currentChainId = getChainIdForSlug(inferredChain);
      }
    } else if (inferredChain && inferredChain !== chain) {
      currentChainId = getChainIdForSlug(inferredChain);
    }
  }

  if (currentChainId === targetChainId) {
    return;
  }

  if (currentChainId === undefined && !strict) {
    return;
  }

  if (currentChainId !== targetChainId) {
    try {
      await requestWithTimeout(provider, {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: toHexChainId(targetChainId) }],
      }, CHAIN_SWITCH_TIMEOUT_MS);
    } catch (switchError) {
      if (isUserRejectedError(switchError)) {
        throw new Error("Network switch request was rejected in wallet");
      }
      if (shouldAddChain(switchError)) {
        await requestWithTimeout(provider, {
          method: "wallet_addEthereumChain",
          params: [getAddEthereumChainParams(chain)],
        }, CHAIN_SWITCH_TIMEOUT_MS);
        await requestWithTimeout(provider, {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: toHexChainId(targetChainId) }],
        }, CHAIN_SWITCH_TIMEOUT_MS);
      } else {
        const code =
          switchError && typeof switchError === "object" && typeof (switchError as { code?: unknown }).code === "number"
            ? (switchError as { code: number }).code
            : undefined;
        const message =
          switchError && typeof switchError === "object"
            ? String(
                (switchError as { message?: unknown; details?: unknown }).message ??
                  (switchError as { details?: unknown }).details ??
                  "",
              ).toLowerCase()
            : "";
        const supportsFallback =
          code === -32601 ||
          code === 4200 ||
          message.includes("not supported") ||
          message.includes("unsupported");
        if (!supportsFallback || typeof wallet.switchChain !== "function") {
          throw switchError;
        }
        await withTimeout(wallet.switchChain(targetChainId), "wallet.switchChain", CHAIN_SWITCH_TIMEOUT_MS);
      }
    }

    // Privy can return a new provider instance after switching.
    provider = await getWalletEthereumProvider(wallet);
  }

  await waitForWalletChainId(wallet, targetChainId);
}

function hasEthereumProvider(wallet: unknown): wallet is { getEthereumProvider(): Promise<unknown> } {
  if (!wallet || typeof wallet !== "object") {
    return false;
  }

  return typeof (wallet as { getEthereumProvider?: unknown }).getEthereumProvider === "function";
}

function hasWalletAddress(wallet: unknown): wallet is { address: string } {
  if (!wallet || typeof wallet !== "object") {
    return false;
  }

  return typeof (wallet as { address?: unknown }).address === "string";
}

function walletClientTypeOf(wallet: unknown) {
  if (!wallet || typeof wallet !== "object") {
    return "";
  }

  const record = wallet as Record<string, unknown>;
  const values = [
    record.walletClientType,
    record.connectorType,
    record.walletType,
    record.type,
  ];

  for (const value of values) {
    if (typeof value === "string") {
      return value.toLowerCase();
    }
  }

  return "";
}

export function isLikelyEmbeddedWallet(wallet: unknown) {
  const type = walletClientTypeOf(wallet);
  return type.includes("embedded") || type.includes("privy");
}

export function usePrivyWallet() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallet: activeWallet } = useActiveWallet();
  const { wallets } = useWallets();

  const compatibleWallets = wallets.filter(
    (wallet): wallet is (typeof wallets)[number] => hasEthereumProvider(wallet) && hasWalletAddress(wallet),
  );
  const userWalletAddress =
    user && typeof user === "object" && "wallet" in user && user.wallet && typeof user.wallet === "object"
      ? ((user.wallet as { address?: string }).address?.toLowerCase() ?? undefined)
      : undefined;
  const walletFromUser = userWalletAddress
    ? compatibleWallets.find((entry) => entry.address.toLowerCase() === userWalletAddress)
    : undefined;

  const activeEthereumWallet =
    hasEthereumProvider(activeWallet) && hasWalletAddress(activeWallet)
      ? (activeWallet as (typeof wallets)[number])
      : undefined;
  const activeWalletAddress = activeEthereumWallet?.address.toLowerCase();
  const fallbackWallet = [...compatibleWallets].sort((a, b) => {
    const aEmbedded = isLikelyEmbeddedWallet(a) ? 1 : 0;
    const bEmbedded = isLikelyEmbeddedWallet(b) ? 1 : 0;
    if (aEmbedded !== bEmbedded) {
      return bEmbedded - aEmbedded;
    }
    return b.connectedAt - a.connectedAt;
  })[0];
  const wallet =
    activeEthereumWallet ?? walletFromUser ?? fallbackWallet;
  const walletConnected = Boolean(authenticated && wallet?.address);

  return {
    ready,
    authenticated,
    walletConnected,
    wallet,
    address: wallet?.address,
    disconnect: logout,
  };
}

export type ConnectedPrivyWallet = NonNullable<
  ReturnType<typeof usePrivyWallet>["wallet"]
>;
export { fetchWalletPortfolio };

export async function createPrivyWalletClient(
  wallet: ConnectedPrivyWallet,
  chain: ChainSlug,
  options?: { strictChainCheck?: boolean },
): Promise<WalletClient> {
  const targetChain = getRuntimeChain(chain);
  if (options?.strictChainCheck === false) {
    await ensureWalletChainOptimistic(wallet, chain);
  } else {
    await ensureWalletChain(wallet, chain);
  }
  const provider = await getWalletEthereumProvider(wallet);

  const viemAccount = await toViemAccount({ wallet });

  return createWalletClient({
    account: viemAccount,
    chain: targetChain,
    transport: custom(provider),
  });
}

export function createChainPublicClient(chain: ChainSlug) {
  const runtimeChain = getRuntimeChain(chain);

  return createPublicClient({
    chain: runtimeChain,
    transport: createChainTransport(chain),
  });
}

export async function resolveEnsName(address: string): Promise<string | undefined> {
  if (!ensClient) {
    return undefined;
  }
  try {
    const resolved = await ensClient.getEnsName({ address: getAddress(address) });
    return resolved ?? undefined;
  } catch {
    return undefined;
  }
}
