import { useEffect, useMemo, useState } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { encodeFunctionData, isAddress, parseEther, parseUnits } from "viem";
import { sendErc20, sendNative } from "@/features/transactions/send";
import {
  ensureWalletChainOptimistic,
  isLikelyEmbeddedWallet,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";
import { useAppStore } from "@/lib/store/app-store";
import {
  ActionButton,
  ERC20_TRANSFER_ABI,
  Field,
  InlineError,
  Input,
  SubmittedTx,
  courierSendSchema,
  formatDisplayAmount,
  normalizeWalletInteractionError,
  refreshPortfolioAfterInteraction,
  shortHash,
  toAssetKey,
  withInteractionTimeout,
} from "./shared";

export function SendSelectPanel() {
  const activeChain = useAppStore((state) => state.session.activeChain);
  const minions = useAppStore((state) => state.minions.list);
  const selectedSendAssetKey = useAppStore(
    (state) => state.overlays.sendSelectedAssetKey,
  );
  const setSendStep = useAppStore((state) => state.setSendStep);

  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === activeChain),
    [activeChain, minions],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedSendAssetKey),
    [chainMinions, selectedSendAssetKey],
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
        <p className="text-[11px] font-semibold text-cyan-100/70">Courier Selection</p>
        <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Choose Asset Minion</h2>
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
        onClick={() => setSendStep("details")}
        type="button"
      >
        Continue
      </button>
    </section>
  );
}

export function SendPanel() {
  const activeChain = useAppStore((state) => state.session.activeChain);
  const { address, wallet } = usePrivyWallet();
  const interactionStatus = useAppStore(
    (state) => state.presence.local?.interactionStatus ?? "idle",
  );
  const { sendTransaction: sendPrivyTransaction } = useSendTransaction();
  const assets = useAppStore((state) => state.portfolio.assets);
  const minions = useAppStore((state) => state.minions.list);
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const selectedSendAssetKey = useAppStore(
    (state) => state.overlays.sendSelectedAssetKey,
  );
  const setSendSelection = useAppStore((state) => state.setSendSelection);
  const setSendStep = useAppStore((state) => state.setSendStep);
  const setInteractionStatus = useAppStore((state) => state.setInteractionStatus);
  const queryClient = useQueryClient();
  const sendableAssets = useMemo(
    () =>
      assets.filter((asset) => {
        if (asset.chain !== activeChain) {
          return false;
        }
        return asset.address === "native" || isAddress(asset.address);
      }),
    [activeChain, assets],
  );
  const chainMinions = useMemo(
    () => minions.filter((minion) => minion.chain === activeChain),
    [activeChain, minions],
  );
  const selectedMinion = useMemo(
    () =>
      chainMinions.find((minion) => minion.assetKey === selectedSendAssetKey),
    [chainMinions, selectedSendAssetKey],
  );
  const selectedSendAsset = useMemo(() => {
    if (!selectedMinion) {
      return undefined;
    }
    return sendableAssets.find(
      (asset) => toAssetKey(asset.chain, asset.address) === selectedMinion.assetKey,
    );
  }, [selectedMinion, sendableAssets]);

  const [targetAddress, setTargetAddress] = useState(nearbyTarget ?? "");
  const [amount, setAmount] = useState("0.001");
  const [formError, setFormError] = useState<string>();
  const [submittedTx, setSubmittedTx] = useState<SubmittedTx>();

  const formValidation = useMemo(
    () => courierSendSchema.safeParse({ amount, targetAddress }),
    [amount, targetAddress],
  );
  const waitForSendReceipt = useWaitForTransactionReceipt({
    chainId: submittedTx ? runtimeConfig.chains[submittedTx.chain].chainId : undefined,
    hash: submittedTx?.hash,
    query: {
      enabled: Boolean(submittedTx),
    },
  });

  useEffect(() => {
    if (chainMinions.length === 0) {
      if (selectedSendAssetKey) {
        setSendSelection(undefined);
      }
      return;
    }
    if (!selectedMinion) {
      setSendSelection(chainMinions[0]!.assetKey);
    }
  }, [chainMinions, selectedMinion, selectedSendAssetKey, setSendSelection]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      try {
        if (!address) {
          throw new Error("Connect a wallet first");
        }
        if (!wallet) {
          throw new Error("No Privy wallet is connected");
        }
        if (!selectedSendAsset) {
          throw new Error("Selected asset is not sendable on this chain");
        }
        const parseResult = courierSendSchema.safeParse({ amount, targetAddress });
        if (!parseResult.success) {
          throw new Error(parseResult.error.issues[0]?.message ?? "Invalid transfer details");
        }
        const normalizedAmount = parseResult.data.amount.replace(",", ".").trim();
        const chainId = runtimeConfig.chains[selectedSendAsset.chain].chainId;

        setInteractionStatus("sending");
        if (isLikelyEmbeddedWallet(wallet)) {
          if (selectedSendAsset.address === "native") {
            const { hash } = await withInteractionTimeout(
              sendPrivyTransaction(
                {
                  to: parseResult.data.targetAddress as `0x${string}`,
                  value: parseEther(normalizedAmount),
                  chainId,
                },
                { address: wallet.address },
              ),
              "Wallet did not open in time. Reopen wallet and retry.",
            );
            return { chain: selectedSendAsset.chain, hash } satisfies SubmittedTx;
          }

          const decimals =
            typeof selectedSendAsset.decimals === "number" && Number.isInteger(selectedSendAsset.decimals)
              ? selectedSendAsset.decimals
              : 18;
          const data = encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [parseResult.data.targetAddress as `0x${string}`, parseUnits(normalizedAmount, decimals)],
          });
          const { hash } = await withInteractionTimeout(
            sendPrivyTransaction(
              {
                to: selectedSendAsset.address as `0x${string}`,
                data,
                value: 0n,
                chainId,
              },
              { address: wallet.address },
            ),
            "Wallet did not open in time. Reopen wallet and retry.",
          );
          return { chain: selectedSendAsset.chain, hash } satisfies SubmittedTx;
        }

        await ensureWalletChainOptimistic(wallet, selectedSendAsset.chain);
        if (selectedSendAsset.address === "native") {
          const hash = await sendNative({
            wallet,
            kind: "send-native",
            chain: selectedSendAsset.chain,
            amount: normalizedAmount,
            assetAddress: "native",
            targetAddress: parseResult.data.targetAddress,
          });

          return { chain: selectedSendAsset.chain, hash } satisfies SubmittedTx;
        }

        const hash = await sendErc20({
          wallet,
          kind: "send-erc20",
          chain: selectedSendAsset.chain,
          amount: normalizedAmount,
          assetAddress: selectedSendAsset.address,
          assetDecimals: selectedSendAsset.decimals,
          targetAddress: parseResult.data.targetAddress,
        });

        return { chain: selectedSendAsset.chain, hash } satisfies SubmittedTx;
      } catch (error) {
        console.error("[courier-send] send failed", error);
        throw normalizeWalletInteractionError(error);
      }
    },
    onError: (error: Error) => {
      setInteractionStatus("idle");
      toast.error(error.message);
    },
    onSuccess: (result) => {
      setSubmittedTx(result);
      setInteractionStatus("idle");
      toast.success(`Transfer submitted: ${shortHash(result.hash)}`);
    },
  });
  const sendLockedByOtherInteraction =
    interactionStatus === "swapping" || interactionStatus === "bridging";
  const sendBusy = sendMutation.isPending || sendLockedByOtherInteraction;

  useEffect(() => {
    if (!waitForSendReceipt.isSuccess || !submittedTx) {
      return;
    }

    const complete = async () => {
      if (address) {
        await refreshPortfolioAfterInteraction(queryClient, address, [submittedTx.chain]);
      }
      toast.success(`Transfer confirmed: ${shortHash(submittedTx.hash)}`);
      setSubmittedTx(undefined);
    };

    void complete();
  }, [address, queryClient, submittedTx, waitForSendReceipt.isSuccess]);

  useEffect(() => {
    if (!waitForSendReceipt.isError || !submittedTx) {
      return;
    }
    toast.error("Transfer confirmation failed. Check wallet activity.");
    setSubmittedTx(undefined);
  }, [submittedTx, waitForSendReceipt.isError]);

  const selectedAssetSymbol = selectedSendAsset?.symbol ?? selectedMinion?.symbol ?? "token";
  const selectedAssetBalance = selectedSendAsset
    ? formatDisplayAmount(selectedSendAsset.balance, 3)
    : "0";

  return (
    <section className="rounded-2xl border border-cyan-100/20 bg-[#08141c]/96 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-xl border border-cyan-100/20 bg-[#0d2030]/88 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            aria-label="Back to minion selection"
            className="rounded-lg border border-cyan-100/30 bg-[#102b3c] px-2 py-1 text-sm font-medium leading-none text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#16384d]"
            onClick={() => setSendStep("select")}
            type="button"
          >
            ←
          </button>
          <div>
            <p className="text-[11px] font-semibold text-cyan-100/70">Courier Details</p>
            <h2 className="mt-0.5 text-lg font-semibold text-cyan-50 text-balance">Courier Post</h2>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-cyan-100/75 text-pretty">
          Set amount and destination address.
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

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (sendBusy) {
            return;
          }
          if (!formValidation.success) {
            setFormError(formValidation.error.issues[0]?.message ?? "Invalid transfer details");
            return;
          }
          setFormError(undefined);
          sendMutation.mutate();
        }}
      >
        <Field label="Destination address">
          <Input
            disabled={sendBusy}
            onChange={(value) => {
              setTargetAddress(value);
              if (formError) {
                setFormError(undefined);
              }
            }}
            placeholder="0x..."
            value={targetAddress}
          />
        </Field>
        <Field label={`Amount in ${selectedAssetSymbol}`}>
          <Input
            disabled={sendBusy}
            inputMode="decimal"
            onChange={(value) => {
              setAmount(value);
              if (formError) {
                setFormError(undefined);
              }
            }}
            type="number"
            value={amount}
          />
        </Field>
        <ActionButton
          buttonType="submit"
          disabled={sendBusy || !formValidation.success || !selectedSendAsset}
        >
          <span className="block text-xs text-cyan-100/70">Transfer</span>
          <span className="mt-0.5 block text-base">
            {sendMutation.isPending
              ? "Confirm in wallet..."
              : `Send ${amount || "0"} ${selectedAssetSymbol}`}
          </span>
        </ActionButton>
      </form>

      {sendLockedByOtherInteraction ? (
        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/78 text-pretty">
          {interactionStatus === "swapping"
            ? "Swap is in progress. Finish it before sending."
            : "Another action is in progress. Try again in a moment."}
        </p>
      ) : null}
      <InlineError message={formError ?? sendMutation.error?.message} />
    </section>
  );
}
