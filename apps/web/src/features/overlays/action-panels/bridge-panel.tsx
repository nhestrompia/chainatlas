import type { ChainSlug } from "@chainatlas/shared";
import { resumeBridge, startBridge } from "@/features/transactions/bridge";
import {
  ensureWalletChain,
  getConnectedWalletChain,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { fetchBridgeJobs } from "@/lib/api/client";
import { runtimeConfig } from "@/lib/config/runtime";
import { getBridgeRegistryEntry } from "@/lib/protocol-registry";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useWaitForTransactionReceipt } from "wagmi";
import {
  ActionButton,
  Field,
  InlineError,
  Input,
  Select,
  SubmittedTx,
  chainLabel,
  formatDisplayAmount,
  refreshPortfolioAfterInteraction,
  toAssetKey,
} from "./shared";

type BridgeErrorDisplay = {
  key: string;
  message: string;
  details?: string;
};

function extractRpcHost(rawMessage: string) {
  const urlMatch = rawMessage.match(/URL:\s*(https?:\/\/[^\s]+)/i);
  if (!urlMatch?.[1]) {
    return undefined;
  }
  try {
    return new URL(urlMatch[1]).host;
  } catch {
    return urlMatch[1];
  }
}

function toBridgeErrorDisplay(rawMessage: string): BridgeErrorDisplay {
  const compact = rawMessage.replace(/\s+/g, " ").trim();
  const lowered = compact.toLowerCase();
  const rpcHost = extractRpcHost(rawMessage);

  if (lowered.includes("rpc endpoint") && lowered.includes("not reachable")) {
    return {
      key: compact,
      message: compact,
    };
  }

  if (
    lowered.includes("http request failed") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("network request failed")
  ) {
    const chainHint = lowered.includes("polygon")
      ? "Polygon"
      : lowered.includes("base")
        ? "Base"
        : "Ethereum";
    const hostHint = rpcHost ? ` (${rpcHost})` : "";
    return {
      key: compact,
      message: `Could not reach the ${chainHint} RPC endpoint${hostHint}. Configure RPC env vars and retry.`,
      details: rawMessage,
    };
  }

  if (compact.length > 220) {
    return {
      key: compact,
      message: `${compact.slice(0, 220)}...`,
      details: rawMessage,
    };
  }

  return {
    key: compact,
    message: compact,
  };
}

export function BridgeSelectPanel() {
  const activeChain = useAppStore((state) => state.session.activeChain);
  const assets = useAppStore((state) => state.portfolio.assets);
  const minions = useAppStore((state) => state.minions.list);
  const selectedBridgeAssetKey = useAppStore(
    (state) => state.overlays.bridgeSelectedAssetKey,
  );
  const setBridgeStep = useAppStore((state) => state.setBridgeStep);
  const registry = runtimeConfig.protocolRegistry;

  const sourceChain = activeChain;
  const bridgeEntry = useMemo(
    () => getBridgeRegistryEntry(registry),
    [registry],
  );
  const bridgeableAssetKeys = useMemo(
    () =>
      new Set(
        (bridgeEntry?.supportedTokens ?? [])
          .filter((token) => token.chain === sourceChain)
          .map((token) => toAssetKey(token.chain, token.address))
          .filter((key): key is string => Boolean(key)),
      ),
    [bridgeEntry?.supportedTokens, sourceChain],
  );
  const bridgeableAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const key = toAssetKey(asset.chain, asset.address);
        return key ? bridgeableAssetKeys.has(key) : false;
      }),
    [assets, bridgeableAssetKeys],
  );
  const bridgeableAssetMap = useMemo(
    () =>
      new Map(
        bridgeableAssets.map((asset) => [
          toAssetKey(asset.chain, asset.address),
          asset,
        ]),
      ),
    [bridgeableAssets],
  );
  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === sourceChain),
    [minions, sourceChain],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedBridgeAssetKey),
    [chainMinions, selectedBridgeAssetKey],
  );
  const selectedBridgeAsset = useMemo(
    () =>
      selectedMinion
        ? bridgeableAssetMap.get(selectedMinion.assetKey)
        : undefined,
    [bridgeableAssetMap, selectedMinion],
  );
  const selectedBalance = useMemo(
    () =>
      selectedBridgeAsset
        ? formatDisplayAmount(selectedBridgeAsset.balance, 3)
        : selectedMinion
          ? formatDisplayAmount(selectedMinion.balance, 3)
          : undefined,
    [selectedBridgeAsset, selectedMinion],
  );

  return (
    <section className="rounded-2xl border border-cyan-100/20 bg-[#08141c]/96 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-xl border border-cyan-100/20 bg-[#0d2030]/88 px-3 py-2">
        <p className="text-[11px] font-semibold text-cyan-100/70">Bridge Selection</p>
        <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Choose Bridge Minion</h2>
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

      {selectedMinion && !selectedBridgeAsset ? (
        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/78 text-pretty">
          Selected minion token is not bridgeable on this chain yet.
        </p>
      ) : null}

      <button
        className="mt-3 w-full rounded-xl border border-cyan-100/30 bg-[#123044] px-4 py-2.5 text-left font-semibold text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#194460] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!selectedMinion || !selectedBridgeAsset}
        onClick={() => setBridgeStep("details")}
        type="button"
      >
        Continue
      </button>
    </section>
  );
}

export function BridgePanel() {
  const { address, wallet } = usePrivyWallet();
  const activeChain = useAppStore((state) => state.session.activeChain);
  const assets = useAppStore((state) => state.portfolio.assets);
  const minions = useAppStore((state) => state.minions.list);
  const jobs = useAppStore((state) => state.pendingTransactions.jobs);
  const selectedBridgeAssetKey = useAppStore(
    (state) => state.overlays.bridgeSelectedAssetKey,
  );
  const setBridgeSelection = useAppStore((state) => state.setBridgeSelection);
  const setBridgeStep = useAppStore((state) => state.setBridgeStep);
  const setPendingJobs = useAppStore((state) => state.setPendingJobs);
  const setInteractionStatus = useAppStore(
    (state) => state.setInteractionStatus,
  );
  const queryClient = useQueryClient();
  const registry = runtimeConfig.protocolRegistry;

  const sourceChain = activeChain;
  const [amount, setAmount] = useState("0.005");
  const [destinationChain, setDestinationChain] = useState<ChainSlug>("polygon");
  const [submittedTx, setSubmittedTx] = useState<SubmittedTx>();

  const walletChainQuery = useQuery({
    enabled: Boolean(wallet),
    queryKey: ["wallet-chain", wallet?.address],
    queryFn: async () => {
      if (!wallet) {
        return undefined;
      }
      return getConnectedWalletChain(wallet);
    },
    staleTime: 5_000,
  });
  const waitForBridgeReceipt = useWaitForTransactionReceipt({
    chainId: submittedTx
      ? runtimeConfig.chains[submittedTx.chain].chainId
      : undefined,
    hash: submittedTx?.hash,
    query: {
      enabled: Boolean(submittedTx),
    },
  });

  const bridgeEntry = useMemo(
    () => getBridgeRegistryEntry(registry),
    [registry],
  );
  const destinationChainOptions = useMemo(
    () =>
      (bridgeEntry?.chainSupport ?? []).filter(
        (chain): chain is ChainSlug => chain !== sourceChain,
      ),
    [bridgeEntry?.chainSupport, sourceChain],
  );
  const bridgeableAssetKeys = useMemo(
    () =>
      new Set(
        (bridgeEntry?.supportedTokens ?? [])
          .filter((token) => token.chain === sourceChain)
          .map((token) => toAssetKey(token.chain, token.address))
          .filter((key): key is string => Boolean(key)),
      ),
    [bridgeEntry?.supportedTokens, sourceChain],
  );
  const bridgeableAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const key = toAssetKey(asset.chain, asset.address);
        return key ? bridgeableAssetKeys.has(key) : false;
      }),
    [assets, bridgeableAssetKeys],
  );
  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === sourceChain),
    [minions, sourceChain],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedBridgeAssetKey),
    [chainMinions, selectedBridgeAssetKey],
  );
  const selectedBridgeAsset = useMemo(() => {
    if (!selectedMinion) {
      return undefined;
    }
    return bridgeableAssets.find(
      (asset) => toAssetKey(asset.chain, asset.address) === selectedMinion.assetKey,
    );
  }, [bridgeableAssets, selectedMinion]);
  useEffect(() => {
    if (!destinationChainOptions.length) {
      return;
    }

    if (
      destinationChain === sourceChain ||
      !destinationChainOptions.includes(destinationChain)
    ) {
      const preferredDestination =
        sourceChain === "ethereum" || sourceChain === "base"
          ? destinationChainOptions.find((chain) => chain === "polygon")
          : undefined;
      setDestinationChain(preferredDestination ?? destinationChainOptions[0]!);
    }
  }, [destinationChain, destinationChainOptions, sourceChain]);

  useEffect(() => {
    if (!chainMinions.length) {
      if (selectedBridgeAssetKey) {
        setBridgeSelection(undefined);
      }
      return;
    }
    if (!selectedMinion) {
      setBridgeSelection(chainMinions[0]!.assetKey);
    }
  }, [
    chainMinions,
    selectedBridgeAssetKey,
    selectedMinion,
    setBridgeSelection,
  ]);

  useQuery({
    enabled: Boolean(address),
    queryKey: ["bridge-jobs", address],
    queryFn: async () => {
      try {
        const result = await fetchBridgeJobs(address!);
        setPendingJobs(result);
        return result;
      } catch {
        setPendingJobs([]);
        return [];
      }
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!wallet) {
        throw new Error("No Privy wallet is connected");
      }
      if (!destinationChainOptions.length) {
        throw new Error("Across has no destination chain available from this island");
      }
      if (sourceChain === destinationChain) {
        throw new Error("Source and destination chains must differ");
      }
      if (!selectedBridgeAsset) {
        throw new Error("Selected minion token is not bridgeable on this chain");
      }
      await ensureWalletChain(wallet, sourceChain);

      setInteractionStatus("bridging");
      const job = await startBridge({
        wallet,
        kind: "bridge",
        chain: sourceChain,
        destinationChain,
        amount,
        assetAddress: selectedBridgeAsset.address,
      });

      return {
        chain: sourceChain,
        job,
      };
    },
    onError: () => {
      setInteractionStatus("idle");
    },
    onSuccess: async (result) => {
      if (result.job.txHash) {
        setSubmittedTx({ chain: result.chain, hash: result.job.txHash });
        return;
      }

      if (!address) {
        setInteractionStatus("idle");
        return;
      }

      try {
        const refreshedJobs = await queryClient.fetchQuery({
          queryKey: ["bridge-jobs", address],
          queryFn: () => fetchBridgeJobs(address),
        });
        setPendingJobs(refreshedJobs);
      } catch {
        setPendingJobs([]);
      }
      setInteractionStatus("idle");
    },
  });

  const switchChainMutation = useMutation({
    mutationFn: async () => {
      if (!wallet) {
        throw new Error("No Privy wallet is connected");
      }
      await ensureWalletChain(wallet, sourceChain);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["wallet-chain", wallet?.address],
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const job = jobs.find((item) => item.id === jobId);
      if (!job) {
        throw new Error("Unknown bridge job");
      }
      return resumeBridge(job);
    },
    onSuccess: async () => {
      if (address) {
        try {
          const refreshedJobs = await queryClient.fetchQuery({
            queryKey: ["bridge-jobs", address],
            queryFn: () => fetchBridgeJobs(address),
          });
          setPendingJobs(refreshedJobs);
        } catch {
          setPendingJobs([]);
        }
      }
    },
  });

  const bridgeBusy =
    startMutation.isPending ||
    switchChainMutation.isPending ||
    waitForBridgeReceipt.isLoading;

  useEffect(() => {
    if (!waitForBridgeReceipt.isSuccess || !submittedTx) {
      return;
    }

    const complete = async () => {
      if (address) {
        try {
          const refreshedJobs = await queryClient.fetchQuery({
            queryKey: ["bridge-jobs", address],
            queryFn: () => fetchBridgeJobs(address),
          });
          setPendingJobs(refreshedJobs);
          await refreshPortfolioAfterInteraction(queryClient, address, [
            sourceChain,
            destinationChain,
          ]);
        } catch {
          setPendingJobs([]);
        }
      }
      setSubmittedTx(undefined);
      setInteractionStatus("idle");
    };

    void complete();
  }, [
    address,
    destinationChain,
    queryClient,
    setInteractionStatus,
    setPendingJobs,
    sourceChain,
    submittedTx,
    waitForBridgeReceipt.isSuccess,
  ]);

  useEffect(() => {
    if (!waitForBridgeReceipt.isError || !submittedTx) {
      return;
    }
    setSubmittedTx(undefined);
    setInteractionStatus("idle");
  }, [setInteractionStatus, submittedTx, waitForBridgeReceipt.isError]);

  const submitBridge = () => {
    if (
      !bridgeBusy &&
      sourceChain !== destinationChain &&
      destinationChainOptions.length > 0 &&
      amount &&
      selectedBridgeAsset
    ) {
      startMutation.mutate();
    }
  };

  const walletChain = walletChainQuery.data;
  const walletNeedsSwitch = Boolean(walletChain && walletChain !== sourceChain);
  const bridgeErrors = useMemo(
    () => {
      const unique = new Map<string, BridgeErrorDisplay>();
      for (const rawMessage of [
        startMutation.error?.message,
        switchChainMutation.error?.message,
        refreshMutation.error?.message,
        waitForBridgeReceipt.error?.message,
      ]) {
        if (!rawMessage) {
          continue;
        }
        const formatted = toBridgeErrorDisplay(rawMessage);
        unique.set(formatted.key, formatted);
      }
      return [...unique.values()];
    },
    [
      refreshMutation.error?.message,
      startMutation.error?.message,
      switchChainMutation.error?.message,
      waitForBridgeReceipt.error?.message,
    ],
  );
  const recentJobs = jobs.slice(0, 2);
  const selectedAssetSymbol =
    selectedBridgeAsset?.symbol ?? selectedMinion?.symbol ?? "token";
  const selectedAssetBalance = selectedBridgeAsset
    ? formatDisplayAmount(selectedBridgeAsset.balance, 3)
    : "0";

  return (
    <section className="rounded-2xl border border-cyan-100/20 bg-[#08141c]/96 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-xl border border-cyan-100/20 bg-[#0d2030]/88 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            aria-label="Back to minion selection"
            className="rounded-lg border border-cyan-100/30 bg-[#102b3c] px-2 py-1 text-sm font-medium leading-none text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#16384d]"
            onClick={() => setBridgeStep("select")}
            type="button"
          >
            ←
          </button>
          <div>
            <p className="text-[11px] font-semibold text-cyan-100/70">Bridge Details</p>
            <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Bridge Gate</h2>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-cyan-100/75 text-pretty">
          Confirm amount and bridge destination.
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2">
        <p className="text-sm font-semibold text-cyan-50">
          {selectedAssetSymbol}
        </p>
        <p className="text-xs text-cyan-100/75 tabular-nums">
          Balance: {selectedAssetBalance} {selectedAssetSymbol}
        </p>
      </div>

      {!selectedBridgeAsset ? (
        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/78 text-pretty">
          Selected minion token is not bridgeable on this chain.
        </p>
      ) : null}

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitBridge();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Current chain">
            <Input
              disabled
              onChange={() => undefined}
              readOnly
              value={chainLabel(sourceChain)}
            />
          </Field>
          <Field label="Destination chain">
            <Select
              disabled={bridgeBusy || destinationChainOptions.length === 0}
              onChange={(value) => {
                if (destinationChainOptions.includes(value as ChainSlug)) {
                  setDestinationChain(value as ChainSlug);
                }
              }}
              options={destinationChainOptions.map((chain) => ({
                value: chain,
                label: chainLabel(chain),
              }))}
              value={destinationChainOptions.includes(destinationChain) ? destinationChain : ""}
            />
          </Field>
        </div>

        <Field label={`Amount in ${selectedAssetSymbol}`}>
          <Input
            disabled={bridgeBusy}
            inputMode="decimal"
            onChange={setAmount}
            type="number"
            value={amount}
          />
        </Field>

        {walletNeedsSwitch ? (
          <ActionButton
            className="mt-1"
            disabled={bridgeBusy}
            onClick={() => switchChainMutation.mutate()}
          >
            <span className="block text-xs text-cyan-100/70">Wallet network</span>
            <span className="mt-0.5 block text-base">
              Switch to {chainLabel(sourceChain)}
            </span>
          </ActionButton>
        ) : null}

        <ActionButton
          buttonType="submit"
          className="mt-1"
          disabled={
            bridgeBusy ||
            destinationChainOptions.length === 0 ||
            sourceChain === destinationChain ||
            !amount ||
            !selectedBridgeAsset
          }
        >
          <span className="block text-base">
            {waitForBridgeReceipt.isLoading ? "Confirming transaction..." : "Bridge now"}
          </span>
        </ActionButton>
      </form>

      <div className="mt-3 space-y-1.5">
        {recentJobs.length === 0 ? (
          <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/70 text-pretty">
            No bridge jobs yet. Start a transfer to create a resumable record.
          </p>
        ) : (
          recentJobs.map((job) => (
            <button
              key={job.id}
              className={cn(
                "w-full rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-left hover:bg-cyan-50/15 disabled:cursor-not-allowed disabled:opacity-50",
                job.status === "completed" && "border-emerald-300/55",
              )}
              disabled={bridgeBusy || refreshMutation.isPending}
              onClick={() => refreshMutation.mutate(job.id)}
              type="button"
            >
              <p className="text-sm font-medium text-cyan-50">
                {job.sourceChain} to {job.destinationChain} · {job.status}
              </p>
              <p className="text-xs text-cyan-100/55">
                depositId: {job.depositId ?? "pending"}
              </p>
            </button>
          ))
        )}
      </div>

      {bridgeErrors.map((error) => (
        <InlineError key={error.key} details={error.details} message={error.message} />
      ))}
    </section>
  );
}
