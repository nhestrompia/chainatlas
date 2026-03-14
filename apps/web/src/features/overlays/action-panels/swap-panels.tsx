import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { getAddress, isAddress } from "viem";
import { executeSwap } from "@/features/transactions/swap";
import { ensureWalletChain, usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";
import { getSwapRoutesForChain } from "@/lib/protocol-registry";
import { useAppStore } from "@/lib/store/app-store";
import {
  ActionButton,
  DEXSCREENER_TOKENS_API,
  Field,
  InlineError,
  Input,
  SubmittedTx,
  formatDisplayAmount,
  fromAssetKey,
  refreshPortfolioAfterInteraction,
  shortHash,
} from "./shared";

export function SwapSelectPanel() {
  const activeChain = useAppStore((state) => state.session.activeChain);
  const minions = useAppStore((state) => state.minions.list);
  const selectedSwapAssetKey = useAppStore(
    (state) => state.overlays.swapSelectedAssetKey,
  );
  const setSwapStep = useAppStore((state) => state.setSwapStep);

  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === activeChain),
    [activeChain, minions],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedSwapAssetKey),
    [chainMinions, selectedSwapAssetKey],
  );
  const selectedBalance = useMemo(
    () =>
      selectedMinion
        ? formatDisplayAmount(selectedMinion.balance, 3)
        : undefined,
    [selectedMinion],
  );

  return (
    <section className="rounded-2xl border border-cyan-100/20 bg-[#08141c]/96 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-xl border border-cyan-100/20 bg-[#0d2030]/88 px-3 py-2">
        <p className="text-[11px] font-semibold text-cyan-100/70">Swap Selection</p>
        <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Choose Source Minion</h2>
        <p className="mt-0.5 text-xs text-cyan-100/75 text-pretty">
          Click a minion or use arrow keys to change selection, then continue.
        </p>
      </div>

      {chainMinions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/75 text-pretty">
          No minions are available on this island yet.
        </p>
      ) : selectedMinion ? (
        <div className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2">
          <p className="text-xs text-cyan-100/70">Selected asset</p>
          <p className="text-sm font-semibold text-cyan-50">
            {selectedMinion.symbol} · {selectedMinion.name}
          </p>
          <p className="mt-0.5 text-xs text-cyan-100/75 tabular-nums">
            Balance: {selectedBalance} {selectedMinion.symbol}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/75 text-pretty">
          No minion selected yet.
        </p>
      )}

      <button
        className="mt-3 w-full rounded-xl border border-cyan-100/30 bg-[#123044] px-4 py-2.5 text-left font-semibold text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#194460] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!selectedMinion}
        onClick={() => setSwapStep("details")}
        type="button"
      >
        Continue
      </button>
    </section>
  );
}

export function SwapPanel() {
  const { address, wallet } = usePrivyWallet();
  const interactionStatus = useAppStore(
    (state) => state.presence.local?.interactionStatus ?? "idle",
  );
  const activeChain = useAppStore((state) => state.session.activeChain);
  const minions = useAppStore((state) => state.minions.list);
  const selectedSwapAssetKey = useAppStore(
    (state) => state.overlays.swapSelectedAssetKey,
  );
  const setSwapSelection = useAppStore((state) => state.setSwapSelection);
  const setSwapStep = useAppStore((state) => state.setSwapStep);
  const setInteractionStatus = useAppStore((state) => state.setInteractionStatus);
  const queryClient = useQueryClient();
  const registry = runtimeConfig.protocolRegistry;

  const [targetTokenAddress, setTargetTokenAddress] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [submittedTx, setSubmittedTx] = useState<SubmittedTx>();

  const routes = useMemo(
    () => getSwapRoutesForChain(registry, activeChain),
    [activeChain, registry],
  );
  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === activeChain),
    [activeChain, minions],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedSwapAssetKey),
    [chainMinions, selectedSwapAssetKey],
  );
  const selectedSourceAddress = useMemo(() => {
    const parsed = fromAssetKey(selectedMinion?.assetKey);
    if (!parsed) {
      return undefined;
    }
    if (parsed.address === "native") {
      return "native";
    }
    if (!isAddress(parsed.address)) {
      return undefined;
    }
    return getAddress(parsed.address);
  }, [selectedMinion?.assetKey]);
  const normalizedTargetTokenAddress = useMemo(() => {
    const candidate = targetTokenAddress.trim();
    if (!candidate || !isAddress(candidate)) {
      return undefined;
    }
    return getAddress(candidate);
  }, [targetTokenAddress]);

  useEffect(() => {
    if (chainMinions.length === 0) {
      if (selectedSwapAssetKey) {
        setSwapSelection(undefined);
      }
      return;
    }
    if (!selectedMinion) {
      setSwapSelection(chainMinions[0]!.assetKey);
    }
  }, [
    chainMinions,
    selectedMinion,
    selectedSwapAssetKey,
    setSwapSelection,
  ]);

  useEffect(() => {
    const defaultRoute = routes.find((route) => {
      if (selectedSourceAddress === "native") {
        return route.supportsNativeIn;
      }
      if (!selectedSourceAddress) {
        return false;
      }
      return route.tokenIn.toLowerCase() === selectedSourceAddress.toLowerCase();
    });
    setTargetTokenAddress((value) => value || defaultRoute?.tokenOut || "");
  }, [routes, selectedSourceAddress]);

  const selectedRoute = useMemo(
    () => {
      if (!normalizedTargetTokenAddress || !selectedSourceAddress) {
        return undefined;
      }
      return routes.find((route) => {
        const matchesTarget =
          route.tokenOut.toLowerCase() === normalizedTargetTokenAddress.toLowerCase();
        if (!matchesTarget) {
          return false;
        }
        if (selectedSourceAddress === "native") {
          return route.supportsNativeIn;
        }
        return route.tokenIn.toLowerCase() === selectedSourceAddress.toLowerCase();
      });
    },
    [normalizedTargetTokenAddress, routes, selectedSourceAddress],
  );
  const tokenMetadataQuery = useQuery({
    enabled: Boolean(normalizedTargetTokenAddress),
    queryKey: ["swap-token-metadata", activeChain, normalizedTargetTokenAddress],
    queryFn: async () => {
      if (!normalizedTargetTokenAddress) {
        return undefined;
      }

      const response = await fetch(
        `${DEXSCREENER_TOKENS_API}/${normalizedTargetTokenAddress}`,
      );
      if (!response.ok) {
        throw new Error("Token metadata lookup is temporarily unavailable.");
      }
      const payload = (await response.json()) as {
        pairs?: Array<{
          chainId?: string;
          baseToken?: { address?: string; name?: string; symbol?: string };
          quoteToken?: { address?: string; name?: string; symbol?: string };
        }>;
      };

      const chainId = activeChain === "ethereum" ? "ethereum" : "base";
      const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
      const matchingChainPairs = pairs.filter(
        (pair) =>
          typeof pair.chainId === "string" &&
          pair.chainId.toLowerCase() === chainId,
      );
      const candidates = matchingChainPairs.length > 0 ? matchingChainPairs : pairs;
      const lowerTarget = normalizedTargetTokenAddress.toLowerCase();

      const matchedToken =
        candidates
          .flatMap((pair) => [pair.baseToken, pair.quoteToken])
          .find(
            (token) =>
              typeof token?.address === "string" &&
              token.address.toLowerCase() === lowerTarget,
          ) ??
        candidates[0]?.baseToken ??
        candidates[0]?.quoteToken;

      const name =
        typeof matchedToken?.name === "string" ? matchedToken.name : undefined;
      const symbol =
        typeof matchedToken?.symbol === "string" ? matchedToken.symbol : undefined;

      return {
        address: normalizedTargetTokenAddress,
        name,
        symbol,
        decimals: undefined,
      };
    },
    staleTime: 120_000,
    retry: 1,
  });
  const normalizedAmountInput = amount.replace(",", ".").trim();
  const parsedAmount = Number(normalizedAmountInput);
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const waitForSwapReceipt = useWaitForTransactionReceipt({
    chainId: submittedTx ? runtimeConfig.chains[submittedTx.chain].chainId : undefined,
    hash: submittedTx?.hash,
    query: {
      enabled: Boolean(submittedTx),
    },
  });

  const swapMutation = useMutation({
    mutationFn: async () => {
      if (!wallet) {
        throw new Error("No Privy wallet is connected");
      }
      if (!selectedSourceAddress) {
        throw new Error("Select one of your minions first");
      }
      if (!selectedRoute) {
        throw new Error("Token is not available in configured swap routes");
      }

      setInteractionStatus("swapping");
      await ensureWalletChain(wallet, activeChain);
      const hash = await executeSwap({
        wallet,
        registry,
        routeId: selectedRoute.routeId,
        kind: "swap",
        chain: activeChain,
        amount: normalizedAmountInput,
        assetAddress: selectedSourceAddress,
        slippageBps: 100,
      });

      return { chain: activeChain, hash } satisfies SubmittedTx;
    },
    onError: (error: Error) => {
      setInteractionStatus("idle");
      toast.error(error.message);
    },
    onSuccess: (result) => {
      setSubmittedTx(result);
      setInteractionStatus("idle");
      toast.success(`Swap submitted: ${shortHash(result.hash)}`);
    },
  });
  const swapLockedByOtherInteraction =
    interactionStatus === "sending" || interactionStatus === "bridging";
  const swapBusy = swapMutation.isPending || swapLockedByOtherInteraction;

  useEffect(() => {
    if (!waitForSwapReceipt.isSuccess || !submittedTx) {
      return;
    }

    const complete = async () => {
      if (address) {
        await refreshPortfolioAfterInteraction(queryClient, address, [submittedTx.chain]);
      }
      toast.success(`Swap confirmed: ${shortHash(submittedTx.hash)}`);
      setSubmittedTx(undefined);
    };

    void complete();
  }, [address, queryClient, submittedTx, waitForSwapReceipt.isSuccess]);

  useEffect(() => {
    if (!waitForSwapReceipt.isError || !submittedTx) {
      return;
    }
    toast.error("Swap confirmation failed. Check wallet activity.");
    setSubmittedTx(undefined);
    setInteractionStatus("idle");
  }, [setInteractionStatus, submittedTx, waitForSwapReceipt.isError]);
  const sourceIsSwappable = useMemo(() => {
    if (!selectedSourceAddress) {
      return false;
    }
    return routes.some((route) => {
      if (selectedSourceAddress === "native") {
        return route.supportsNativeIn;
      }
      return route.tokenIn.toLowerCase() === selectedSourceAddress.toLowerCase();
    });
  }, [routes, selectedSourceAddress]);
  const submitSwap = () => {
    if (!swapBusy && selectedRoute && amountIsValid && sourceIsSwappable) {
      swapMutation.mutate();
    }
  };
  const canExecuteSwap = Boolean(
    selectedRoute && amountIsValid && !swapBusy && sourceIsSwappable,
  );
  const executeDisabledReason = useMemo(() => {
    if (swapLockedByOtherInteraction) {
      if (interactionStatus === "sending") {
        return "Send is in progress. Wait for it before swapping.";
      }
      return "Another action is in progress.";
    }
    if (swapBusy) {
      return "Swap is in progress.";
    }
    if (!selectedMinion) {
      return "Select a source minion first.";
    }
    if (!sourceIsSwappable) {
      return "Selected source token has no configured swap route on this chain.";
    }
    if (!amountIsValid) {
      return "Enter a valid amount (e.g. 0.001).";
    }
    if (!selectedRoute) {
      return "Destination token is not available for the selected source token.";
    }
    return undefined;
  }, [
    amountIsValid,
    interactionStatus,
    selectedMinion,
    selectedRoute,
    sourceIsSwappable,
    swapBusy,
    swapLockedByOtherInteraction,
  ]);
  const tokenLookupMessage = useMemo(() => {
    if (tokenMetadataQuery.isFetching) {
      return "Fetching token metadata...";
    }
    if (tokenMetadataQuery.data?.name || tokenMetadataQuery.data?.symbol) {
      const name = tokenMetadataQuery.data.name ?? "Token";
      const symbol = tokenMetadataQuery.data.symbol ? ` (${tokenMetadataQuery.data.symbol})` : "";
      const decimals =
        typeof tokenMetadataQuery.data.decimals === "number"
          ? ` · ${tokenMetadataQuery.data.decimals} decimals`
          : "";
      return `${name}${symbol}${decimals}`;
    }
    if (normalizedTargetTokenAddress) {
      return "Token metadata unavailable on the current chain for this address.";
    }
    if (targetTokenAddress.trim().length > 0) {
      return "Enter a valid token contract address.";
    }
    return "Paste destination token address.";
  }, [
    normalizedTargetTokenAddress,
    targetTokenAddress,
    tokenMetadataQuery.data,
    tokenMetadataQuery.isFetching,
  ]);
  const sourceBalanceLabel = useMemo(() => {
    if (!selectedMinion) {
      return "0";
    }
    return formatDisplayAmount(selectedMinion.balance, 3);
  }, [selectedMinion]);

  return (
    <section className="rounded-2xl border border-cyan-100/20 bg-[#08141c]/96 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-xl border border-cyan-100/20 bg-[#0d2030]/88 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            aria-label="Back to minion selection"
            className="rounded-lg border border-cyan-100/30 bg-[#102b3c] px-2 py-1 text-sm font-medium leading-none text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#16384d]"
            onClick={() => setSwapStep("select")}
            type="button"
          >
            ←
          </button>
          <div>
            <p className="text-[11px] font-semibold text-cyan-100/70">Swap Details</p>
            <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Swap Hall</h2>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-cyan-100/75 text-pretty">
          Confirm amount and destination token address.
        </p>
      </div>

      {!selectedMinion ? (
        <p className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/75 text-pretty">
          No minion selected. Press `E` in Swap Hall, then click one of your minions.
        </p>
      ) : (
        <div className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2">
          <p className="text-sm font-semibold text-cyan-50">
            {selectedMinion.symbol}
          </p>
          <p className="text-xs text-cyan-100/75 tabular-nums">
            Balance: {sourceBalanceLabel} {selectedMinion.symbol}
          </p>
        </div>
      )}

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitSwap();
        }}
      >
        <Field label="To token address">
          <Input
            disabled={swapBusy}
            onChange={(value) => {
              setTargetTokenAddress(value);
            }}
            placeholder="0x..."
            value={targetTokenAddress}
          />
        </Field>

        <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/75 text-pretty">
          {tokenLookupMessage}
        </p>

        <Field label={selectedMinion ? `Amount in ${selectedMinion.symbol}` : "Amount"}>
          <Input
            disabled={swapBusy || !selectedMinion}
            inputMode="decimal"
            onChange={setAmount}
            type="number"
            value={amount}
          />
        </Field>

        <ActionButton
          buttonType="submit"
          className="mt-2"
          disabled={!canExecuteSwap}
        >
          <span className="block text-xs text-cyan-100/70">Execution</span>
          <span className="mt-0.5 block text-base">
            {swapMutation.isPending ? "Confirm in wallet..." : "Execute swap"}
          </span>
        </ActionButton>
      </form>
      {!sourceIsSwappable && selectedMinion ? (
        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/78 text-pretty">
          This source token is not currently configured for swapping on this chain.
        </p>
      ) : null}
      {!canExecuteSwap && executeDisabledReason ? (
        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/78 text-pretty">
          {executeDisabledReason}
        </p>
      ) : null}
      <InlineError
        message={
          swapMutation.error?.message ??
          waitForSwapReceipt.error?.message
        }
      />
    </section>
  );
}
