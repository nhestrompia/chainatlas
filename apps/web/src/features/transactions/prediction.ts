import type { PredictionMarket } from "@chainatlas/shared";
import { formatUnits, getAddress, parseUnits } from "viem";
import {
  isLikelyEmbeddedWallet,
  type ConnectedPrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { env } from "@/lib/config/env";

const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const USDC_DECIMALS = 6;
const MIN_MARKETABLE_BUY_USDC = 1;
const ALLOWANCE_POLL_TIMEOUT_MS = 20_000;
const ALLOWANCE_POLL_INTERVAL_MS = 1_500;
const POLYGON_USDC_POS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const POLYGON_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const POLYGON_NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const POLYGON_NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
const EOA_MIN_MATIC_FOR_APPROVAL_WEI = 0n;
const ERC20_APPROVE_SELECTOR = "095ea7b3";
const ERC20_ALLOWANCE_SELECTOR = "dd62ed3e";
const MAX_UINT256_HEX = `0x${"f".repeat(64)}`;

type PredictionTradeSide = "yes" | "no";
type PredictionSignatureType = 0 | 1 | 2;
type ApiKeyCreds = {
  key: string;
  passphrase: string;
  secret: string;
};

type WalletProviderLike = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

const apiCredsByAddress = new Map<string, ApiKeyCreds>();
const blockedClobAuthAddresses = new Set<string>();

type ClobClientLike = {
  createAndPostMarketOrder(
    order: {
      tokenID: string;
      amount: number;
      side: unknown;
      orderType?: unknown;
    },
    options: {
      tickSize: string;
      negRisk: boolean;
    },
    orderType: unknown,
  ): Promise<unknown>;
  createOrDeriveApiKey(): Promise<unknown>;
  createApiKey?(nonce?: number): Promise<unknown>;
  deriveApiKey?(nonce?: number): Promise<unknown>;
  getBalanceAllowance(params: {
    asset_type: unknown;
    token_id?: string;
  }): Promise<unknown>;
  updateBalanceAllowance(params: {
    asset_type: unknown;
    token_id?: string;
  }): Promise<unknown>;
  getOrder(orderId: string): Promise<unknown>;
};

type ClobModule = {
  ClobClient: new (
    host: string,
    chainId: number,
    signer: unknown,
    creds?: ApiKeyCreds,
    signatureType?: number,
    funder?: string,
  ) => ClobClientLike;
  OrderType: {
    FAK?: unknown;
    FOK: unknown;
  };
  Side: {
    BUY: unknown;
  };
  AssetType: {
    COLLATERAL: unknown;
    CONDITIONAL: unknown;
  };
};

const FOK_UNFILLABLE_ERROR_FRAGMENT = "fok orders are fully filled or killed";

export type PredictionTradeReceipt = {
  orderId?: string;
  status?: string;
  raw: unknown;
};

export type PredictionOrderStatusReceipt = {
  orderId: string;
  status?: string;
  raw: unknown;
};

type TypedDataField = {
  name: string;
  type: string;
};

type TypedDataParams = {
  account?: unknown;
  domain?: Record<string, unknown>;
  message?: Record<string, unknown>;
  primaryType?: string;
  types?: Record<string, TypedDataField[]>;
};

function getTokenIdForSide(market: PredictionMarket, side: PredictionTradeSide) {
  return side === "yes" ? market.yesTokenId : market.noTokenId;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isValidApiCreds(value: unknown): value is ApiKeyCreds {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === "string" &&
    record.key.length > 0 &&
    typeof record.secret === "string" &&
    record.secret.length > 0 &&
    typeof record.passphrase === "string" &&
    record.passphrase.length > 0
  );
}

function assertValidApiCreds(raw: unknown): ApiKeyCreds {
  if (isValidApiCreds(raw)) {
    return raw;
  }
  const record = toRecord(raw);
  const errorMessage =
    (typeof record.error === "string" && record.error) ||
    (typeof record.errorMsg === "string" && record.errorMsg) ||
    (typeof record.message === "string" && record.message) ||
    "Polymarket API key auth failed. Approve the wallet signature and retry.";
  throw new Error(errorMessage);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const fromRecord =
      (typeof record.message === "string" && record.message) ||
      (typeof record.error === "string" && record.error) ||
      (typeof record.errorMsg === "string" && record.errorMsg);
    if (fromRecord) {
      return fromRecord;
    }
  }
  return "Unknown error";
}

function toPolymarketAuthErrorMessage(error: unknown): string {
  const message = toErrorMessage(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("network error")) {
    return "Unable to reach Polymarket CLOB (network error). Trading appears unavailable from this region/network.";
  }
  return `Polymarket API key auth failed: ${message}`;
}

function isLikelyClobNetworkBlock(error: unknown) {
  const lowered = toErrorMessage(error).toLowerCase();
  return (
    lowered.includes("network error") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("network request failed") ||
    lowered.includes("load failed")
  );
}

function extractOrderReceipt(raw: unknown): PredictionTradeReceipt {
  const record = toRecord(raw);
  const orderIdCandidates = [record.orderID, record.orderId, record.id];
  const statusCandidates = [record.status, record.orderStatus];
  const orderId = orderIdCandidates.find((value) => typeof value === "string") as
    | string
    | undefined;
  const status = statusCandidates.find((value) => typeof value === "string") as
    | string
    | undefined;

  return {
    orderId,
    status,
    raw,
  };
}

function extractOrderStatusReceipt(orderId: string, raw: unknown): PredictionOrderStatusReceipt {
  const record = toRecord(raw);
  const statusCandidates = [record.status, record.orderStatus];
  const status = statusCandidates.find((value) => typeof value === "string") as
    | string
    | undefined;

  return {
    orderId,
    status,
    raw,
  };
}

function assertNoClobError(raw: unknown, fallback: string) {
  const record = toRecord(raw);
  const explicitError =
    (typeof record.error === "string" && record.error) ||
    (typeof record.errorMsg === "string" && record.errorMsg) ||
    (typeof record.message === "string" && record.message);
  const success =
    typeof record.success === "boolean" ? record.success : undefined;

  if (explicitError) {
    throw new Error(explicitError);
  }
  if (success === false) {
    throw new Error(fallback);
  }
}

function isFokUnfillableResponse(raw: unknown) {
  const message = toErrorMessage(raw).toLowerCase();
  return (
    message.includes("couldn't be fully filled") &&
    message.includes(FOK_UNFILLABLE_ERROR_FRAGMENT)
  );
}

function toAmountUnits(amountUsdc: number) {
  return parseUnits(String(amountUsdc), USDC_DECIMALS);
}

function sanitizeTypedDataValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTypedDataValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      next[key] = sanitizeTypedDataValue(item);
    }
    return next;
  }
  return value;
}

function getDomainFieldType(name: string): string | undefined {
  if (name === "name" || name === "version") {
    return "string";
  }
  if (name === "chainId") {
    return "uint256";
  }
  if (name === "verifyingContract") {
    return "address";
  }
  if (name === "salt") {
    return "bytes32";
  }
  return undefined;
}

function buildEip712DomainType(domain: Record<string, unknown>) {
  return Object.keys(domain)
    .map((fieldName) => {
      const type = getDomainFieldType(fieldName);
      return type ? { name: fieldName, type } : undefined;
    })
    .filter((field): field is TypedDataField => Boolean(field));
}

function isInvalidTypedDataError(error: unknown) {
  const message =
    error && typeof error === "object"
      ? String(
          (error as { message?: unknown; details?: unknown }).message ??
            (error as { details?: unknown }).details ??
            "",
        )
      : "";
  const lowered = message.toLowerCase();
  return (
    lowered.includes("invalid typeddata") ||
    lowered.includes("invalid typed data") ||
    lowered.includes("eth_signtypeddata") ||
    lowered.includes("eth_signtypeddata_v4")
  );
}

function isMethodUnsupportedError(error: unknown) {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number"
      ? (error as { code: number }).code
      : undefined;
  const message = toErrorMessage(error).toLowerCase();
  return (
    code === -32601 ||
    code === 4200 ||
    message.includes("not supported") ||
    message.includes("unsupported method") ||
    message.includes("method not found")
  );
}

function isUserRejectedError(error: unknown) {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number"
      ? (error as { code: number }).code
      : undefined;
  if (code === 4001) {
    return true;
  }
  return toErrorMessage(error).toLowerCase().includes("rejected");
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

function isAmbireWallet(wallet: unknown) {
  return walletClientTypeOf(wallet).includes("ambire");
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

async function readProviderChainId(provider: WalletProviderLike) {
  return parseChainId(
    await provider.request({
      method: "eth_chainId",
    }),
  );
}

async function ensureProviderChainId(provider: WalletProviderLike, targetChainId: number) {
  const currentChainId = await readProviderChainId(provider);
  if (currentChainId === targetChainId) {
    return;
  }
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${targetChainId.toString(16)}` }],
  });
}

async function resolveSignerAddress(
  provider: WalletProviderLike,
  fallbackAddress: string,
) {
  const accountsResponse = await provider.request({
    method: "eth_accounts",
  });
  if (Array.isArray(accountsResponse)) {
    const firstAccount = accountsResponse.find(
      (item) => typeof item === "string" && item.length > 0,
    ) as string | undefined;
    if (firstAccount) {
      return getAddress(firstAccount);
    }
  }
  return getAddress(fallbackAddress);
}

async function signTypedDataViaProvider(input: {
  address: string;
  params: TypedDataParams;
  provider: WalletProviderLike;
}) {
  const domain = toRecord(input.params.domain);
  const types = toRecord(input.params.types) as Record<string, TypedDataField[]>;
  const message = toRecord(input.params.message);
  const typedDataPayload = sanitizeTypedDataValue({
    domain,
    message,
    primaryType: input.params.primaryType,
    types: {
      EIP712Domain: buildEip712DomainType(domain),
      ...types,
    },
  });

  const payloadString = JSON.stringify(typedDataPayload);
  const attempts: Array<{ method: string; params: unknown[] }> = [
    { method: "eth_signTypedData_v4", params: [input.address, payloadString] },
    { method: "eth_signTypedData_v4", params: [input.address, typedDataPayload] },
    { method: "eth_signTypedData", params: [input.address, typedDataPayload] },
    { method: "eth_signTypedData", params: [typedDataPayload, input.address] },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return (await input.provider.request({
        method: attempt.method,
        params: attempt.params,
      })) as string;
    } catch (error) {
      lastError = error;
      if (isUserRejectedError(error)) {
        throw error;
      }
      const shouldTryNext =
        isMethodUnsupportedError(error) || isInvalidTypedDataError(error);
      if (!shouldTryNext) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Wallet does not support typed-data signing.");
}

async function createPredictionSignerWithFallback(input: {
  wallet: ConnectedPrivyWallet;
  strictChainCheck?: boolean;
}) {
  const provider = (await input.wallet.getEthereumProvider()) as WalletProviderLike;
  if (input.strictChainCheck ?? true) {
    await ensureProviderChainId(provider, POLYGON_CHAIN_ID);
  }
  const address = await resolveSignerAddress(provider, input.wallet.address);

  return {
    account: { address },
    getAddresses: async () => [address],
    requestAddresses: async () => [address],
    signTypedData: async (params: TypedDataParams) =>
      await signTypedDataViaProvider({
        address,
        params,
        provider,
      }),
  };
}

function toTokenUnitsSafe(value: unknown, decimals: number): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return parseUnits(value.toString(), decimals);
    } catch {
      return 0n;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!normalized) {
      return 0n;
    }
    if (/^0x[0-9a-f]+$/i.test(normalized)) {
      try {
        return BigInt(normalized);
      } catch {
        return 0n;
      }
    }
    if (/^-?\d+$/.test(normalized)) {
      try {
        return BigInt(normalized);
      } catch {
        return 0n;
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      try {
        return parseUnits(normalized, decimals);
      } catch {
        return 0n;
      }
    }
    if (/^-?\d+(\.\d+)?e[-+]?\d+$/i.test(normalized)) {
      const asNumber = Number(normalized);
      if (!Number.isFinite(asNumber)) {
        return 0n;
      }
      try {
        return parseUnits(asNumber.toFixed(decimals), decimals);
      } catch {
        return 0n;
      }
    }
    try {
      return BigInt(normalized);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function formatUsdcUnits(value: bigint) {
  const raw = formatUnits(value, USDC_DECIMALS);
  return raw.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatMaticUnits(valueWei: bigint) {
  const raw = formatUnits(valueWei, 18);
  return raw.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function encodeErc20BalanceOf(account: string) {
  const selector = "70a08231";
  const accountParam = account.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x${selector}${accountParam}`;
}

function encodeErc20Approve(spender: string, amountHex: string) {
  const spenderParam = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const amountParam = amountHex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x${ERC20_APPROVE_SELECTOR}${spenderParam}${amountParam}`;
}

function encodeErc20Allowance(owner: string, spender: string) {
  const ownerParam = owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const spenderParam = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x${ERC20_ALLOWANCE_SELECTOR}${ownerParam}${spenderParam}`;
}

function resolvePredictionSignatureConfig(input: { walletAddress: string }): {
  funderAddress: string;
  signatureType: PredictionSignatureType;
} {
  const rawSignatureType = env.polymarketSignatureType.trim();
  const signatureType: PredictionSignatureType =
    rawSignatureType.length === 0
      ? 0
      : rawSignatureType === "0" || rawSignatureType === "1" || rawSignatureType === "2"
        ? (Number(rawSignatureType) as PredictionSignatureType)
        : (() => {
            throw new Error(
              "Invalid VITE_POLYMARKET_SIGNATURE_TYPE. Use 0 (EOA), 1 (POLY_PROXY), or 2 (POLY_GNOSIS_SAFE).",
            );
          })();

  const configuredFunder = env.polymarketFunderAddress
    ? getAddress(env.polymarketFunderAddress)
    : undefined;

  if ((signatureType === 1 || signatureType === 2) && !configuredFunder) {
    throw new Error(
      "Missing VITE_POLYMARKET_FUNDER_ADDRESS for Polymarket signature type 1/2.",
    );
  }

  return {
    signatureType,
    funderAddress: configuredFunder ?? input.walletAddress,
  };
}

async function readErc20BalanceUnits(input: {
  provider: WalletProviderLike;
  ownerAddress: string;
  tokenAddress: string;
}) {
  try {
    const response = await input.provider.request({
      method: "eth_call",
      params: [
        {
          to: input.tokenAddress,
          data: encodeErc20BalanceOf(input.ownerAddress),
        },
        "latest",
      ],
    });
    if (typeof response === "string" && response.startsWith("0x")) {
      return BigInt(response);
    }
  } catch {
    // Best-effort diagnostics only.
  }
  return undefined;
}

async function readNativeBalanceWei(input: {
  provider: WalletProviderLike;
  ownerAddress: string;
}) {
  try {
    const response = await input.provider.request({
      method: "eth_getBalance",
      params: [input.ownerAddress, "latest"],
    });
    if (typeof response === "string" && response.startsWith("0x")) {
      return BigInt(response);
    }
  } catch {
    // Best-effort diagnostics only.
  }
  return undefined;
}

async function readErc20AllowanceUnits(input: {
  ownerAddress: string;
  provider: WalletProviderLike;
  spender: string;
  tokenAddress: string;
}) {
  try {
    const response = await input.provider.request({
      method: "eth_call",
      params: [
        {
          to: input.tokenAddress,
          data: encodeErc20Allowance(input.ownerAddress, input.spender),
        },
        "latest",
      ],
    });
    if (typeof response === "string" && response.startsWith("0x")) {
      return BigInt(response);
    }
  } catch {
    // Best-effort diagnostics only.
  }
  return undefined;
}

function isReceiptSuccess(receipt: unknown) {
  if (!receipt || typeof receipt !== "object") {
    return false;
  }
  const status = (receipt as { status?: unknown }).status;
  return status === "0x1" || status === 1 || status === "1";
}

async function waitForTransactionReceipt(input: {
  provider: WalletProviderLike;
  txHash: string;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? 60_000;
  while (Date.now() - startedAt <= timeoutMs) {
    const receipt = await input.provider.request({
      method: "eth_getTransactionReceipt",
      params: [input.txHash],
    });
    if (receipt) {
      if (isReceiptSuccess(receipt)) {
        return;
      }
      throw new Error("USDC approval transaction failed on-chain.");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Timed out waiting for USDC approval transaction confirmation.");
}

async function submitManualEoaUsdcApproval(input: {
  wallet: ConnectedPrivyWallet;
  spender: string;
}) {
  const provider = (await input.wallet.getEthereumProvider()) as WalletProviderLike;
  const from = getAddress(input.wallet.address);
  await ensureProviderChainId(provider, POLYGON_CHAIN_ID);
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: POLYGON_USDC_POS,
        data: encodeErc20Approve(input.spender, MAX_UINT256_HEX),
        value: "0x0",
      },
    ],
  });
  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("Wallet did not return an approval transaction hash.");
  }
  await waitForTransactionReceipt({
    provider,
    txHash,
  });
}

function getRequiredUsdcSpenders() {
  return [
    POLYGON_EXCHANGE,
    POLYGON_NEG_RISK_EXCHANGE,
    POLYGON_NEG_RISK_ADAPTER,
  ];
}

async function readOnchainUsdcAllowances(input: {
  ownerAddress: string;
  provider: WalletProviderLike;
}) {
  const spenders = getRequiredUsdcSpenders();
  const allowances = await Promise.all(
    spenders.map(async (spender) => ({
      allowance:
        (await readErc20AllowanceUnits({
          ownerAddress: input.ownerAddress,
          provider: input.provider,
          spender,
          tokenAddress: POLYGON_USDC_POS,
        })) ?? 0n,
      spender,
    })),
  );
  return allowances;
}

async function ensureOnchainUsdcApprovalsForEoa(input: {
  ownerAddress: string;
  provider: WalletProviderLike;
  requiredUnits: bigint;
  wallet: ConnectedPrivyWallet;
}) {
  const allowances = await readOnchainUsdcAllowances({
    ownerAddress: input.ownerAddress,
    provider: input.provider,
  });
  const missingSpenders = allowances
    .filter((item) => item.allowance < input.requiredUnits)
    .map((item) => item.spender);

  for (const spender of missingSpenders) {
    await submitManualEoaUsdcApproval({
      spender,
      wallet: input.wallet,
    });
  }
}

async function getPolygonUsdcDiagnostics(wallet: ConnectedPrivyWallet) {
  const provider = (await wallet.getEthereumProvider()) as WalletProviderLike;
  const ownerAddress = getAddress(wallet.address);
  const [posUsdcBalance, nativeUsdcBalance, maticBalanceWei] = await Promise.all([
    readErc20BalanceUnits({
      provider,
      ownerAddress,
      tokenAddress: POLYGON_USDC_POS,
    }),
    readErc20BalanceUnits({
      provider,
      ownerAddress,
      tokenAddress: POLYGON_USDC_NATIVE,
    }),
    readNativeBalanceWei({
      provider,
      ownerAddress,
    }),
  ]);

  return { nativeUsdcBalance, posUsdcBalance, maticBalanceWei };
}

function buildInsufficientBalanceMessage(input: {
  clobBalanceRaw: unknown;
  clobBalanceUnits: bigint;
  requiredUnits: bigint;
  walletDiagnostics?: Awaited<ReturnType<typeof getPolygonUsdcDiagnostics>>;
}) {
  const requiredText = formatUsdcUnits(input.requiredUnits);
  const availableText = formatUsdcUnits(input.clobBalanceUnits);
  const rawBalanceText =
    typeof input.clobBalanceRaw === "string" && input.clobBalanceRaw.trim().length > 0
      ? ` (raw=${input.clobBalanceRaw})`
      : "";
  const base =
    `Insufficient Polymarket collateral for this order. ` +
    `Required ${requiredText} USDC, CLOB available ${availableText} USDC${rawBalanceText}.`;

  const diagnostics = input.walletDiagnostics;
  if (!diagnostics) {
    return `${base} Polymarket trading uses Polygon PoS USDC (${shortAddress(POLYGON_USDC_POS)}), not native Polygon USDC (${shortAddress(POLYGON_USDC_NATIVE)}).`;
  }

  const posBalance = diagnostics.posUsdcBalance;
  const nativeBalance = diagnostics.nativeUsdcBalance;
  const maticBalance = diagnostics.maticBalanceWei;
  const posText = typeof posBalance === "bigint" ? formatUsdcUnits(posBalance) : "?";
  const nativeText = typeof nativeBalance === "bigint" ? formatUsdcUnits(nativeBalance) : "?";
  const maticText = typeof maticBalance === "bigint" ? formatMaticUnits(maticBalance) : "?";

  if (
    typeof posBalance === "bigint" &&
    posBalance === 0n &&
    typeof nativeBalance === "bigint" &&
    nativeBalance > 0n
  ) {
    return (
      `${base} Wallet diagnostics: ${nativeText} native Polygon USDC ` +
      `(${shortAddress(POLYGON_USDC_NATIVE)}) and ${posText} Polygon PoS USDC ` +
      `(${shortAddress(POLYGON_USDC_POS)}). MATIC gas balance: ${maticText}. ` +
      `Convert/bridge to Polygon PoS USDC for Polymarket trades.`
    );
  }

  return (
    `${base} Wallet diagnostics: ${posText} Polygon PoS USDC ` +
    `(${shortAddress(POLYGON_USDC_POS)}) and ${nativeText} native Polygon USDC ` +
    `(${shortAddress(POLYGON_USDC_NATIVE)}). MATIC gas balance: ${maticText}.`
  );
}

async function getClobModule() {
  return (await import("@polymarket/clob-client")) as ClobModule;
}

async function getOrCreateApiCreds(input: {
  address: string;
  signer: unknown;
  module: ClobModule;
}) {
  const cacheKey = input.address.toLowerCase();
  if (blockedClobAuthAddresses.has(cacheKey)) {
    throw new Error(
      "Polymarket CLOB is unavailable from this region/network for this wallet session.",
    );
  }
  const cached = apiCredsByAddress.get(cacheKey);
  if (cached) {
    return cached;
  }

  const TempClobClient = input.module.ClobClient as unknown as new (
    ...args: unknown[]
  ) => ClobClientLike;
  const tempClient = new TempClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    input.signer,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );

  // Prefer derive first to avoid an unnecessary second signature prompt
  // when an API key already exists.
  if (typeof tempClient.deriveApiKey === "function") {
    try {
      const derivedRaw = await tempClient.deriveApiKey();
      const derived = assertValidApiCreds(derivedRaw);
      apiCredsByAddress.set(cacheKey, derived);
      return derived;
    } catch (error) {
      const messageRaw = toErrorMessage(error);
      const message = messageRaw.toLowerCase();
      const likelyMissingKey =
        message.includes("not found") ||
        message.includes("no api key") ||
        message.includes("404") ||
        message.includes("api key does not exist") ||
        message.includes("could not derive api key");
      if (!likelyMissingKey) {
        if (isLikelyClobNetworkBlock(error)) {
          blockedClobAuthAddresses.add(cacheKey);
        }
        throw new Error(toPolymarketAuthErrorMessage(error));
      }
    }
  }

  if (typeof tempClient.createApiKey === "function") {
    try {
      const createdRaw = await tempClient.createApiKey();
      const created = assertValidApiCreds(createdRaw);
      apiCredsByAddress.set(cacheKey, created);
      return created;
    } catch (error) {
      if (isLikelyClobNetworkBlock(error)) {
        blockedClobAuthAddresses.add(cacheKey);
      }
      throw new Error(toPolymarketAuthErrorMessage(error));
    }
  }

  throw new Error(
    "Polymarket API key auth failed: unable to derive or create API credentials.",
  );
}

async function ensureMarketBuyAllowance(input: {
  amountUsdc: number;
  client: ClobClientLike;
  module: ClobModule;
  tokenId: string;
  wallet: ConnectedPrivyWallet;
  signatureType: PredictionSignatureType;
}) {
  const required = toAmountUnits(input.amountUsdc);
  const ownerAddress = getAddress(input.wallet.address);
  const provider = (await input.wallet.getEthereumProvider()) as WalletProviderLike;

  // Fast path for EOAs: use direct on-chain checks/approvals instead of waiting
  // on CLOB balance-allowance cache refresh/update endpoints.
  if (input.signatureType === 0) {
    const onchainBalance =
      (await readErc20BalanceUnits({
        ownerAddress,
        provider,
        tokenAddress: POLYGON_USDC_POS,
      })) ?? 0n;

    if (onchainBalance < required) {
      const walletDiagnostics = await getPolygonUsdcDiagnostics(input.wallet).catch(
        () => undefined,
      );
      throw new Error(
        buildInsufficientBalanceMessage({
          requiredUnits: required,
          clobBalanceRaw: onchainBalance.toString(),
          clobBalanceUnits: onchainBalance,
          walletDiagnostics,
        }),
      );
    }

    const diagnostics = await getPolygonUsdcDiagnostics(input.wallet).catch(
      () => undefined,
    );
    const maticBalanceWei = diagnostics?.maticBalanceWei;
    if (
      typeof maticBalanceWei === "bigint" &&
      maticBalanceWei <= EOA_MIN_MATIC_FOR_APPROVAL_WEI
    ) {
      const maticText = formatMaticUnits(maticBalanceWei);
      throw new Error(
        `USDC approval requires Polygon gas in EOA mode. Current MATIC: ${maticText}. ` +
          `Top up MATIC and retry, or configure Polymarket smart-wallet mode with ` +
          `VITE_POLYMARKET_SIGNATURE_TYPE=2 and VITE_POLYMARKET_FUNDER_ADDRESS.`,
      );
    }

    await ensureOnchainUsdcApprovalsForEoa({
      ownerAddress,
      provider,
      requiredUnits: required,
      wallet: input.wallet,
    });

    const allowancesAfterApproval = await readOnchainUsdcAllowances({
      ownerAddress,
      provider,
    });
    const stillMissing = allowancesAfterApproval.filter(
      (entry) => entry.allowance < required,
    );
    if (stillMissing.length > 0) {
      const spenderList = stillMissing
        .map((entry) => shortAddress(entry.spender))
        .join(", ");
      throw new Error(
        `USDC approval not finalized for required spender(s): ${spenderList}. ` +
          "Please confirm wallet approvals and retry.",
      );
    }

    return;
  }

  const collateralResponse = await input.client.getBalanceAllowance({
    asset_type: input.module.AssetType.COLLATERAL,
  });
  assertNoClobError(collateralResponse, "Unable to read collateral allowance.");
  const collateralRecord = toRecord(collateralResponse);
  const collateralBalance = toTokenUnitsSafe(collateralRecord.balance, USDC_DECIMALS);
  const collateralAllowance = toTokenUnitsSafe(
    collateralRecord.allowance,
    USDC_DECIMALS,
  );

  if (collateralBalance < required) {
    const walletDiagnostics = await getPolygonUsdcDiagnostics(input.wallet).catch(
      () => undefined,
    );
    throw new Error(
      buildInsufficientBalanceMessage({
        requiredUnits: required,
        clobBalanceRaw: collateralRecord.balance,
        clobBalanceUnits: collateralBalance,
        walletDiagnostics,
      }),
    );
  }

  if (collateralAllowance >= required) {
    return;
  }

  const approvalResponse = await input.client.updateBalanceAllowance({
    asset_type: input.module.AssetType.COLLATERAL,
  });
  assertNoClobError(
    approvalResponse,
    "Collateral approval failed. Confirm the approval transaction in wallet.",
  );
  const startedAt = Date.now();
  let refreshedAllowance = 0n;
  let refreshedAllowanceRaw: unknown;
  while (Date.now() - startedAt <= ALLOWANCE_POLL_TIMEOUT_MS) {
    const refreshed = await input.client.getBalanceAllowance({
      asset_type: input.module.AssetType.COLLATERAL,
    });
    assertNoClobError(refreshed, "Unable to verify updated collateral allowance.");
    const refreshedRecord = toRecord(refreshed);
    refreshedAllowanceRaw = refreshedRecord.allowance;
    refreshedAllowance = toTokenUnitsSafe(
      refreshedAllowanceRaw,
      USDC_DECIMALS,
    );
    if (refreshedAllowance >= required) {
      break;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, ALLOWANCE_POLL_INTERVAL_MS),
    );
  }

  if (refreshedAllowance < required) {
    const requiredText = formatUsdcUnits(required);
    const allowanceText = formatUsdcUnits(refreshedAllowance);
    const rawAllowanceText =
      typeof refreshedAllowanceRaw === "string" && refreshedAllowanceRaw.trim().length > 0
        ? ` (raw=${refreshedAllowanceRaw})`
        : "";
    const walletDiagnostics = await getPolygonUsdcDiagnostics(input.wallet).catch(
      () => undefined,
    );
    const posText =
      walletDiagnostics && typeof walletDiagnostics.posUsdcBalance === "bigint"
        ? formatUsdcUnits(walletDiagnostics.posUsdcBalance)
        : "?";
    const maticText =
      walletDiagnostics && typeof walletDiagnostics.maticBalanceWei === "bigint"
        ? formatMaticUnits(walletDiagnostics.maticBalanceWei)
        : "?";
    throw new Error(
      `Collateral approval is still pending (required ${requiredText} USDC, current allowance ${allowanceText} USDC${rawAllowanceText}). ` +
        `No allowance change was detected. Check wallet for a pending/blocked "Approve USDC" transaction on Polygon, ensure you have MATIC for gas (current ${maticText}), and retry. ` +
        `Polygon PoS USDC wallet balance: ${posText}.`,
    );
  }

  // Pre-warm conditional token allowance path used by CLOB settlement.
  const conditionalResponse = await input.client.getBalanceAllowance({
    asset_type: input.module.AssetType.CONDITIONAL,
    token_id: input.tokenId,
  });
  assertNoClobError(conditionalResponse, "Unable to read conditional token allowance.");
}

async function createPredictionClobClient(input: {
  module: ClobModule;
  wallet: ConnectedPrivyWallet;
  funderAddress: string;
  signatureType: PredictionSignatureType;
  strictChainCheck?: boolean;
}) {
  const signer = await createPredictionSignerWithFallback({
    wallet: input.wallet,
    strictChainCheck: input.strictChainCheck,
  });
  const creds = await getOrCreateApiCreds({
    address: input.wallet.address,
    signer,
    module: input.module,
  });

  return new input.module.ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    signer,
    creds,
    input.signatureType,
    input.funderAddress,
  );
}

export async function executePredictionOrder(input: {
  amountUsdc: number;
  market: PredictionMarket;
  side: PredictionTradeSide;
  wallet: ConnectedPrivyWallet;
}) {
  const tokenId = getTokenIdForSide(input.market, input.side);
  if (!tokenId) {
    throw new Error("This market is missing token IDs and cannot be traded yet.");
  }
  if (input.amountUsdc <= 0 || !Number.isFinite(input.amountUsdc)) {
    throw new Error("Invalid amount. Enter a value greater than 0.");
  }
  if (input.amountUsdc < MIN_MARKETABLE_BUY_USDC) {
    throw new Error("Minimum marketable buy size is $1 USDC.");
  }
  if (!input.wallet.address) {
    throw new Error("Connect a wallet before placing a trade.");
  }
  if (isLikelyEmbeddedWallet(input.wallet)) {
    throw new Error(
      "Prediction trading currently requires an external EOA wallet (e.g. MetaMask).",
    );
  }
  if (isAmbireWallet(input.wallet)) {
    throw new Error(
      "Ambire wallet is not supported for Polymarket CLOB auth in this flow. Use a standard EOA wallet (MetaMask, Rabby, Coinbase Wallet).",
    );
  }
  const walletAddress = getAddress(input.wallet.address);
  const signatureConfig = resolvePredictionSignatureConfig({
    walletAddress,
  });

  const clob = await getClobModule();
  const client = await createPredictionClobClient({
    module: clob,
    wallet: input.wallet,
    funderAddress: signatureConfig.funderAddress,
    signatureType: signatureConfig.signatureType,
    strictChainCheck: true,
  });

  await ensureMarketBuyAllowance({
    amountUsdc: input.amountUsdc,
    client,
    module: clob,
    tokenId,
    wallet: input.wallet,
    signatureType: signatureConfig.signatureType,
  });

  const orderType = clob.OrderType.FAK ?? clob.OrderType.FOK;
  const response = await client.createAndPostMarketOrder(
    {
      tokenID: tokenId,
      amount: input.amountUsdc,
      side: clob.Side.BUY,
      orderType,
    },
    {
      tickSize: input.market.tickSize ?? "0.01",
      negRisk: Boolean(input.market.negRisk),
    },
    orderType,
  );
  if (isFokUnfillableResponse(response)) {
    throw new Error(
      "Not enough immediate liquidity to fill this amount. Try a smaller amount or retry shortly.",
    );
  }
  assertNoClobError(response, "Order submission was rejected.");

  return extractOrderReceipt(response);
}

export async function fetchPredictionOrderStatus(input: {
  orderId: string;
  wallet: ConnectedPrivyWallet;
}) {
  if (!input.wallet.address) {
    throw new Error("Connect a wallet before checking order status.");
  }

  const clob = await getClobModule();
  const walletAddress = getAddress(input.wallet.address);
  const signatureConfig = resolvePredictionSignatureConfig({
    walletAddress,
  });
  const client = await createPredictionClobClient({
    module: clob,
    wallet: input.wallet,
    funderAddress: signatureConfig.funderAddress,
    signatureType: signatureConfig.signatureType,
    strictChainCheck: false,
  });
  const response = await client.getOrder(input.orderId);
  const responseRecord = toRecord(response);
  const responseError =
    (typeof responseRecord.error === "string" && responseRecord.error) ||
    (typeof responseRecord.errorMsg === "string" && responseRecord.errorMsg) ||
    (typeof responseRecord.message === "string" && responseRecord.message);
  if (responseError && responseError.toLowerCase().includes("no order")) {
    return {
      orderId: input.orderId,
      status: "pending_indexing",
      raw: response,
    };
  }
  assertNoClobError(response, "Unable to fetch order status from CLOB.");
  return extractOrderStatusReceipt(input.orderId, response);
}
