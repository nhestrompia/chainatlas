import type { PredictionMarket } from "@chainatlas/shared";
import { parseUnits } from "viem";
import {
  createPrivyWalletClient,
  ensureWalletChain,
  isLikelyEmbeddedWallet,
  type ConnectedPrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";

const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = runtimeConfig.chains.polygon.chainId;
const USDC_DECIMALS = 6;
const ALLOWANCE_POLL_TIMEOUT_MS = 45_000;
const ALLOWANCE_POLL_INTERVAL_MS = 2_500;

type PredictionTradeSide = "yes" | "no";
type ApiKeyCreds = {
  key: string;
  passphrase: string;
  secret: string;
};

const apiCredsByAddress = new Map<string, ApiKeyCreds>();

type ClobClientLike = {
  createAndPostMarketOrder(
    order: {
      tokenID: string;
      amount: number;
      side: unknown;
    },
    options: {
      tickSize: string;
      negRisk: boolean;
    },
    orderType: unknown,
  ): Promise<unknown>;
  createOrDeriveApiKey(): Promise<ApiKeyCreds>;
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

function getTokenIdForSide(market: PredictionMarket, side: PredictionTradeSide) {
  return side === "yes" ? market.yesTokenId : market.noTokenId;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function toAmountUnits(amountUsdc: number) {
  return parseUnits(String(amountUsdc), USDC_DECIMALS);
}

function toBigIntSafe(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
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
  const cached = apiCredsByAddress.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tempClient = new input.module.ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    input.signer,
  );
  const derived = await tempClient.createOrDeriveApiKey();
  apiCredsByAddress.set(cacheKey, derived);
  return derived;
}

async function ensureMarketBuyAllowance(input: {
  amountUsdc: number;
  client: ClobClientLike;
  module: ClobModule;
  tokenId: string;
}) {
  const required = toAmountUnits(input.amountUsdc);

  const collateralResponse = await input.client.getBalanceAllowance({
    asset_type: input.module.AssetType.COLLATERAL,
  });
  assertNoClobError(collateralResponse, "Unable to read collateral allowance.");
  const collateralRecord = toRecord(collateralResponse);
  const collateralBalance = toBigIntSafe(collateralRecord.balance);
  const collateralAllowance = toBigIntSafe(collateralRecord.allowance);

  if (collateralBalance < required) {
    throw new Error("Insufficient USDC balance for this order.");
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
  while (Date.now() - startedAt <= ALLOWANCE_POLL_TIMEOUT_MS) {
    const refreshed = await input.client.getBalanceAllowance({
      asset_type: input.module.AssetType.COLLATERAL,
    });
    assertNoClobError(refreshed, "Unable to verify updated collateral allowance.");
    refreshedAllowance = toBigIntSafe(toRecord(refreshed).allowance);
    if (refreshedAllowance >= required) {
      break;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, ALLOWANCE_POLL_INTERVAL_MS),
    );
  }
  if (refreshedAllowance < required) {
    throw new Error(
      "Collateral approval is still pending. Please wait a few seconds and retry.",
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
  strictChainCheck?: boolean;
}) {
  const signer = await createPrivyWalletClient(input.wallet, "polygon", {
    strictChainCheck: input.strictChainCheck ?? true,
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
    0,
    input.wallet.address,
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
  if (!input.wallet.address) {
    throw new Error("Connect a wallet before placing a trade.");
  }
  if (isLikelyEmbeddedWallet(input.wallet)) {
    throw new Error(
      "Prediction trading currently requires an external EOA wallet (e.g. MetaMask).",
    );
  }

  await ensureWalletChain(input.wallet, "polygon");

  const clob = await getClobModule();
  const client = await createPredictionClobClient({
    module: clob,
    wallet: input.wallet,
    strictChainCheck: true,
  });

  await ensureMarketBuyAllowance({
    amountUsdc: input.amountUsdc,
    client,
    module: clob,
    tokenId,
  });

  const response = await client.createAndPostMarketOrder(
    {
      tokenID: tokenId,
      amount: input.amountUsdc,
      side: clob.Side.BUY,
    },
    {
      tickSize: input.market.tickSize ?? "0.01",
      negRisk: Boolean(input.market.negRisk),
    },
    clob.OrderType.FOK,
  );
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
  const client = await createPredictionClobClient({
    module: clob,
    wallet: input.wallet,
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
