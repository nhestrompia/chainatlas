import {
  executePredictionOrder,
  fetchPredictionOrderStatus,
} from "@/features/transactions/prediction";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { useAppStore } from "@/lib/store/app-store";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionButton, Field, Input, PanelFrame } from "./shared";

const BUY_INTENT_EVENT = "prediction:buy-intent";
const MIN_MARKETABLE_BUY_USDC = 1;
const TERMINAL_ORDER_STATUSES = new Set([
  "matched",
  "filled",
  "confirmed",
  "executed",
  "cancelled",
  "canceled",
  "rejected",
  "failed",
]);

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export function PredictionPanel() {
  const { wallet } = usePrivyWallet();
  const index = useAppStore(
    (state) => state.overlays.predictionSelectedMarketIndex,
  );
  const selectedSide = useAppStore(
    (state) => state.overlays.predictionSelectedSide,
  );
  const market = useAppStore((state) =>
    typeof index === "number"
      ? state.predictionMarkets.markets[index]
      : undefined,
  );
  const [side, setSide] = useState<"yes" | "no">(selectedSide ?? "yes");
  const [amount, setAmount] = useState("25");
  const [lastOrderId, setLastOrderId] = useState<string>();
  const [lastOrderStatus, setLastOrderStatus] = useState<string>();

  useEffect(() => {
    setSide(selectedSide ?? "yes");
  }, [index, selectedSide]);

  const normalizedAmount = amount.replace(",", ".").trim();
  const parsedAmount = Number(normalizedAmount);
  const amountIsValid =
    Number.isFinite(parsedAmount) && parsedAmount >= MIN_MARKETABLE_BUY_USDC;
  const selectedPrice = market
    ? side === "yes"
      ? market.yesPrice
      : market.noPrice
    : 0;
  const showingYes = side === "yes";
  const yesWidth = Math.max((market?.yesPrice ?? 0) * 100, 2);
  const noWidth = Math.max((market?.noPrice ?? 0) * 100, 2);

  const estimatedShares =
    amountIsValid && selectedPrice > 0 ? parsedAmount / selectedPrice : 0;
  const marketTradable = Boolean(market?.yesTokenId && market?.noTokenId);
  const tradeMutation = useMutation({
    onMutate: () => {
      if (typeof index === "number") {
        window.dispatchEvent(
          new CustomEvent(BUY_INTENT_EVENT, {
            detail: {
              marketIndex: index,
              side,
              amount: parsedAmount,
            },
          }),
        );
      }
    },
    mutationFn: async () => {
      if (!market) {
        throw new Error("No market selected.");
      }
      if (!wallet) {
        throw new Error("Connect a wallet before placing a trade.");
      }
      if (!amountIsValid) {
        throw new Error("Enter a valid buy amount.");
      }
      return await executePredictionOrder({
        amountUsdc: parsedAmount,
        market,
        side,
        wallet,
      });
    },
    onSuccess: (receipt) => {
      setLastOrderId(receipt.orderId);
      setLastOrderStatus(receipt.status);
      toast.success(
        receipt.orderId
          ? `Order submitted (${receipt.orderId.slice(0, 10)}...)`
          : "Order submitted.",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Trade failed.");
    },
  });

  const submitTrade = () => {
    if (!marketTradable) {
      toast.error("Market is missing token metadata. Try again shortly.");
      return;
    }
    if (tradeMutation.isPending) {
      return;
    }
    tradeMutation.mutate();
  };
  const orderStatusQuery = useQuery({
    enabled: Boolean(wallet && lastOrderId),
    queryFn: async () => {
      if (!wallet || !lastOrderId) {
        throw new Error("Missing wallet or order id");
      }
      return await fetchPredictionOrderStatus({ orderId: lastOrderId, wallet });
    },
    queryKey: ["prediction-order-status", wallet?.address, lastOrderId],
    refetchInterval: (query) => {
      const status = String(
        query.state.data?.status ?? lastOrderStatus ?? "",
      ).toLowerCase();
      return TERMINAL_ORDER_STATUSES.has(status) ? false : 2_500;
    },
    refetchIntervalInBackground: true,
    retry: 1,
  });
  const liveOrderStatus = orderStatusQuery.data?.status ?? lastOrderStatus;

  if (!market) {
    return (
      <PanelFrame title="Prediction Market" subtitle="No market selected.">
        <p className="py-4 text-center text-sm text-cyan-100/60">
          Walk near a prediction gate and press E to view.
        </p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      title="Prediction Market"
      subtitle="Polymarket — Live Probabilities"
    >
      <div className="space-y-4">
        <p className="text-xl font-medium leading-tight text-cyan-50 text-balance">
          {market.question}
        </p>

        <div className="space-y-2">
          {showingYes ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-base">
                <span className="font-extrabold tracking-[0.02em] text-green-400">
                  YES
                </span>
                <span className="text-xl font-black text-green-300">
                  {formatPercent(market.yesPrice)}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-green-950/50">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-700"
                  style={{ width: `${yesWidth}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-base">
                <span className="font-extrabold tracking-[0.02em] text-red-400">
                  NO
                </span>
                <span className="text-xl font-black text-red-300">
                  {formatPercent(market.noPrice)}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-red-950/50">
                <div
                  className="h-full rounded-full bg-red-500 transition-all duration-700"
                  style={{ width: `${noWidth}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-cyan-100/10 pt-3 text-sm font-semibold text-cyan-100/80">
          <span>Volume: {formatVolume(market.volume)}</span>
        </div>

        <div className="space-y-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cyan-100/75">
            Trade
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2.5 text-base font-extrabold transition-colors ${
                side === "yes"
                  ? "border-green-300/70 bg-green-400/20 text-green-100"
                  : "border-cyan-100/25 bg-[#0d1d29] text-cyan-100/75 hover:border-cyan-100/40"
              }`}
              onClick={() => setSide("yes")}
              type="button"
            >
              Buy YES
            </button>
            <button
              className={`rounded-lg border px-3 py-2.5 text-base font-extrabold transition-colors ${
                side === "no"
                  ? "border-red-300/70 bg-red-400/20 text-red-100"
                  : "border-cyan-100/25 bg-[#0d1d29] text-cyan-100/75 hover:border-cyan-100/40"
              }`}
              onClick={() => setSide("no")}
              type="button"
            >
              Buy NO
            </button>
          </div>

          <Field label="Amount (USDC)">
            <Input
              inputMode="decimal"
              onChange={setAmount}
              placeholder="min 1.00"
              type="number"
              value={amount}
            />
          </Field>

          {!amountIsValid ? (
            <p className="text-xs text-amber-100/85">
              Minimum marketable buy size is $1 USDC.
            </p>
          ) : null}

          <div className="rounded-lg border border-cyan-100/20 bg-[#0d1d29] px-3 py-2 text-sm text-cyan-100/85">
            <p>
              Price:{" "}
              <span className="text-base font-extrabold text-cyan-50">
                {formatPercent(selectedPrice)}
              </span>
            </p>
            <p className="mt-0.5">
              Estimated shares:{" "}
              <span className="text-base font-extrabold text-cyan-50">
                {amountIsValid ? estimatedShares.toFixed(2) : "--"}
              </span>
            </p>
          </div>

          <ActionButton
            disabled={
              !amountIsValid || !marketTradable || tradeMutation.isPending
            }
            onClick={submitTrade}
          >
            <span className="block text-xs text-cyan-100/70">Execution</span>
            <span className="mt-0.5 block text-base">
              {tradeMutation.isPending
                ? "Submitting order..."
                : `Buy ${side.toUpperCase()}`}
            </span>
          </ActionButton>

          {lastOrderId ? (
            <div className="rounded-lg border border-emerald-300/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              <p className="font-semibold">Last order submitted</p>
              <p className="mt-0.5 break-all">ID: {lastOrderId}</p>
              {liveOrderStatus ? (
                <p className="mt-0.5">Status: {liveOrderStatus}</p>
              ) : null}
            </div>
          ) : null}

          {lastOrderId && orderStatusQuery.isFetching ? (
            <p className="text-xs text-cyan-100/70">Checking order status...</p>
          ) : null}

          {!marketTradable ? (
            <p className="text-xs text-amber-100/85">
              Trading metadata is still loading for this market. Please retry in
              a moment.
            </p>
          ) : null}

          {tradeMutation.error ? (
            <p className="text-xs text-rose-100/90">
              {(tradeMutation.error as Error).message}
            </p>
          ) : null}

          {orderStatusQuery.error ? (
            <p className="text-xs text-rose-100/90">
              {(orderStatusQuery.error as Error).message}
            </p>
          ) : null}

          <a
            className="inline-flex text-xs font-medium text-cyan-100/75 underline decoration-cyan-100/30 underline-offset-4 transition-colors hover:text-cyan-50"
            href={`https://polymarket.com/event/${market.slug}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open on Polymarket
          </a>
        </div>
      </div>
    </PanelFrame>
  );
}
