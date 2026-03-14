import { nanoid } from "nanoid";
import type { BridgeJob, TransactionIntent } from "@chainatlas/shared";
import { formatUnits, parseUnits } from "viem";
import { createBridgeJob, patchBridgeJob } from "@/lib/api/client";
import {
  executeAcrossBridge,
  fetchAcrossDepositStatus,
  quoteAcrossBridge,
} from "@/features/bridge/across-client";
import { type ConnectedPrivyWallet } from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";

function mapAcrossStatus(status?: string): BridgeJob["status"] {
  const normalized = (status ?? "").toLowerCase();
  if (!normalized) {
    return "submitted";
  }
  if (["filled", "complete", "completed", "success"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "expired", "invalid", "refunded", "canceled", "cancelled"].includes(normalized)) {
    return "failed";
  }
  return "settling";
}

export async function startBridge(input: TransactionIntent & { wallet: ConnectedPrivyWallet }) {
  const destinationChain = input.destinationChain ?? "base";
  if (!input.wallet.address) {
    throw new Error("Privy wallet account is unavailable");
  }

  const quote = await quoteAcrossBridge({
    sourceChain: input.chain,
    destinationChain,
    assetAddress: input.assetAddress ?? "native",
    amount: input.amount,
    recipient: input.wallet.address as `0x${string}`,
  });

  const sourceToken = runtimeConfig.bridge.supportedAssets.find(
    (asset) =>
      asset.chain === input.chain &&
      asset.address.toLowerCase() === (input.assetAddress ?? "native").toLowerCase(),
  );
  const tokenDecimals = sourceToken?.decimals ?? 18;
  const tokenSymbol = sourceToken?.symbol ?? "token";
  const inputAmount = parseUnits(input.amount, tokenDecimals);
  if (quote.isAmountTooLow) {
    const minAmount = formatUnits(quote.limits.minDeposit, tokenDecimals);
    throw new Error(`Amount is below minimum bridge amount (${minAmount} ${tokenSymbol}).`);
  }
  if (inputAmount > quote.limits.maxDeposit) {
    const maxAmount = formatUnits(quote.limits.maxDeposit, tokenDecimals);
    throw new Error(`Amount exceeds max bridge amount (${maxAmount} ${tokenSymbol}).`);
  }

  const execution = await executeAcrossBridge(input.wallet, {
    sourceChain: input.chain,
    destinationChain,
    assetAddress: input.assetAddress ?? "native",
    amount: input.amount,
    recipient: input.wallet.address as `0x${string}`,
  }, undefined, quote);

  const timestamp = new Date().toISOString();
  const quoteTimestamp = Number(quote.deposit.quoteTimestamp);
  const expectedFillSeconds = Number(quote.estimatedFillTimeSec);
  const bridgeSubmitted = Boolean(execution.originTxHash);
  const job: BridgeJob = {
    id: nanoid(),
    protocol: "across",
    address: input.wallet.address,
    sourceChain: input.chain,
    destinationChain,
    originChainId: runtimeConfig.chains[input.chain].chainId,
    destinationChainId: runtimeConfig.chains[destinationChain].chainId,
    depositId: execution.depositId,
    assetAddress: input.assetAddress ?? "native",
    amount: input.amount,
    status: bridgeSubmitted ? "submitted" : "failed",
    txHash: execution.originTxHash,
    originTxHash: execution.originTxHash,
    ...(Number.isFinite(quoteTimestamp) && quoteTimestamp > 0 ? { quoteTimestamp } : {}),
    ...(Number.isFinite(expectedFillSeconds) && expectedFillSeconds > 0
      ? { expectedFillSeconds }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSyncedAt: timestamp,
    nextActionLabel: bridgeSubmitted ? "Check Across status" : "Retry bridge",
    statusDetail: bridgeSubmitted
      ? execution.depositId
        ? "Submitted through Across"
        : "Submitted through Across. Waiting for depositId sync."
      : "Across did not return a bridge transaction hash",
  };

  try {
    return await createBridgeJob(job);
  } catch {
    return {
      ...job,
      statusDetail: "Bridge submitted. Local mode: job persistence API unavailable.",
    };
  }
}

export async function resumeBridge(job: BridgeJob) {
  if (!job.originChainId || !job.depositId) {
    throw new Error("Bridge job is missing Across identifiers");
  }

  const status = await fetchAcrossDepositStatus({
    originChainId: job.originChainId,
    depositId: job.depositId,
  });
  const nextStatus = mapAcrossStatus(status.status);
  const now = new Date().toISOString();

  return patchBridgeJob(job.id, {
    status: nextStatus,
    txHash: status.fillTxHash?.startsWith("0x") ? (status.fillTxHash as `0x${string}`) : job.txHash,
    lastSyncedAt: now,
    statusDetail: status.reason ?? status.message ?? status.status,
    nextActionLabel:
      nextStatus === "completed"
        ? "Bridge complete"
        : nextStatus === "failed"
          ? "Bridge failed"
          : "Await relayer fill",
    updatedAt: now,
  });
}
