import { useState } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store/app-store";
import { ActionButton, Field, Input, PanelFrame } from "./shared";

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
  const index = useAppStore((state) => state.overlays.predictionSelectedMarketIndex);
  const market = useAppStore(
    (state) =>
      typeof index === "number"
        ? state.predictionMarkets.markets[index]
        : undefined,
  );
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("25");

  if (!market) {
    return (
      <PanelFrame title="Prediction Market" subtitle="No market selected.">
        <p className="py-4 text-center text-sm text-cyan-100/60">
          Walk near a prediction gate and press E to view.
        </p>
      </PanelFrame>
    );
  }

  const yesWidth = Math.max(market.yesPrice * 100, 2);
  const noWidth = Math.max(market.noPrice * 100, 2);
  const normalizedAmount = amount.replace(",", ".").trim();
  const parsedAmount = Number(normalizedAmount);
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const selectedPrice = side === "yes" ? market.yesPrice : market.noPrice;

  const estimatedShares =
    amountIsValid && selectedPrice > 0 ? parsedAmount / selectedPrice : 0;

  const openTrade = () => {
    if (!amountIsValid) {
      toast.error("Enter a valid buy amount first.");
      return;
    }
    window.open(
      `https://polymarket.com/event/${market.slug}`,
      "_blank",
      "noopener,noreferrer",
    );
    toast.message(
      `Open order ticket: Buy ${side.toUpperCase()} with $${parsedAmount.toFixed(
        2,
      )}`,
    );
  };

  return (
    <PanelFrame
      title="Prediction Market"
      subtitle="Polymarket — Live Probabilities"
    >
      <div className="space-y-4">
        <p className="text-base font-semibold text-cyan-50 text-balance">
          {market.question}
        </p>

        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-green-400">YES</span>
              <span className="font-bold text-green-300">
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

          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-red-400">NO</span>
              <span className="font-bold text-red-300">
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
        </div>

        <div className="flex items-center justify-between border-t border-cyan-100/10 pt-3 text-xs text-cyan-100/60">
          <span>Volume: {formatVolume(market.volume)}</span>
        </div>

        <div className="space-y-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cyan-100/75">
            Trade
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
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
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
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
              placeholder="e.g. 25"
              type="number"
              value={amount}
            />
          </Field>

          <div className="rounded-lg border border-cyan-100/20 bg-[#0d1d29] px-3 py-2 text-xs text-cyan-100/75">
            <p>
              Price:{" "}
              <span className="font-semibold text-cyan-50">
                {formatPercent(selectedPrice)}
              </span>
            </p>
            <p className="mt-0.5">
              Estimated shares:{" "}
              <span className="font-semibold text-cyan-50">
                {amountIsValid ? estimatedShares.toFixed(2) : "--"}
              </span>
            </p>
          </div>

          <ActionButton disabled={!amountIsValid} onClick={openTrade}>
            <span className="block text-xs text-cyan-100/70">Execution</span>
            <span className="mt-0.5 block text-base">
              Buy {side.toUpperCase()} on Polymarket
            </span>
          </ActionButton>

          <p className="text-xs text-cyan-100/60">
            Opens Polymarket to complete the signed order.
          </p>
        </div>
      </div>
    </PanelFrame>
  );
}
