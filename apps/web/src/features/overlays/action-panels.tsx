import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt } from "wagmi";
import { fetchBridgeJobs } from "@/lib/api/client";
import { resumeBridge, startBridge } from "@/features/transactions/bridge";
import { sendErc20, sendNative } from "@/features/transactions/send";
import { executeSwap } from "@/features/transactions/swap";
import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@/components/ui/select";
import {
  ensureWalletChain,
  ensureWalletChainOptimistic,
  getConnectedWalletChain,
  isLikelyEmbeddedWallet,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";
import { getBridgeRegistryEntry, getSwapRoutesForChain } from "@/lib/protocol-registry";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { encodeFunctionData, getAddress, isAddress, parseEther, parseUnits } from "viem";
import { z } from "zod";

const courierSendSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .refine((value) => Number.isFinite(Number(value.replace(",", "."))), "Enter a valid amount")
    .refine((value) => Number(value.replace(",", ".")) > 0, "Amount must be greater than 0"),
  targetAddress: z
    .string()
    .trim()
    .min(1, "Recipient address is required")
    .refine((value) => isAddress(value), "Enter a valid EVM address"),
});

const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/latest/dex/tokens";
const INTERACTION_TIMEOUT_MS = 45_000;
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function withInteractionTimeout<T>(promise: Promise<T>, timeoutMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), INTERACTION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

type SubmittedTx = {
  chain: "ethereum" | "base";
  hash: `0x${string}`;
};

function toAssetKey(chain: string | undefined, address: string | undefined) {
  if (!chain || !address) {
    return undefined;
  }
  return `${chain}:${address}`.toLowerCase();
}

function fromAssetKey(assetKey: string | undefined) {
  if (!assetKey) {
    return undefined;
  }
  const [chain, address] = assetKey.split(":");
  if (!chain || !address) {
    return undefined;
  }
  return { chain, address };
}

function formatDisplayAmount(value: string, maximumFractionDigits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function chainLabel(chain: "ethereum" | "base") {
  return runtimeConfig.chains[chain].label;
}

function shortHash(hash: `0x${string}`) {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function normalizeWalletInteractionError(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const lowered = rawMessage.toLowerCase();

  if (
    lowered.includes("toLowerCase is not a function".toLowerCase()) ||
    lowered.includes("err.details") ||
    lowered.includes("details is not a function")
  ) {
    return new Error(
      "Wallet returned an invalid error payload. Please retry the transaction. If it persists, reconnect wallet.",
    );
  }

  if (
    lowered.includes("chain mismatch") ||
    lowered.includes("wrong network") ||
    lowered.includes("incorrect network") ||
    lowered.includes("does not match the target chain") ||
    lowered.includes("wallet_switchethereumchain")
  ) {
    return new Error(
      "Wallet network does not match this island. Switch network in wallet, then retry.",
    );
  }

  if (lowered.includes("wallet request timed out")) {
    return new Error(
      "Wallet did not respond in time. Open wallet, confirm any pending prompt, then retry.",
    );
  }

  return error instanceof Error ? error : new Error(rawMessage);
}

async function refreshPortfolioAfterInteraction(
  queryClient: ReturnType<typeof useQueryClient>,
  address: string,
  chains: Array<"ethereum" | "base">,
) {
  const uniqueChains = [...new Set(chains)];
  await Promise.all(
    uniqueChains.flatMap((chain) => [
      queryClient.invalidateQueries({ queryKey: ["portfolio", address, chain] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-assets", address, chain] }),
    ]),
  );
}

function PanelFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-cyan-100/20 bg-[#08141c]/94 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="rounded-2xl border border-cyan-100/20 bg-[#0e2230]/86 px-3 py-2">
        <p className="text-xs font-semibold text-cyan-100/70">Mission Console</p>
        <h2 className="mt-1 text-xl font-semibold text-cyan-50 text-balance">{title}</h2>
        <p className="mt-0.5 text-sm text-cyan-100/75 text-pretty">{subtitle}</p>
      </div>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

function ActionButton({
  buttonType = "button",
  children,
  className,
  disabled,
  onClick,
}: {
  buttonType?: "button" | "submit";
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?(): void;
}) {
  return (
    <button
      className={cn(
        "w-full rounded-xl border border-cyan-100/30 bg-[#123044] px-4 py-2.5 text-left font-semibold text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-[#194460] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      disabled={disabled}
      onClick={() => onClick?.()}
      type={buttonType}
    >
      {children}
    </button>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-cyan-100/72">{label}</span>
      {children}
    </label>
  );
}

function Input({
  disabled,
  inputMode,
  onChange,
  placeholder,
  readOnly,
  type,
  value,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  type?: "text" | "number";
  onChange(value: string): void;
}) {
  return (
    <input
      className="w-full rounded-xl border border-cyan-100/25 bg-[#0d1d29] px-3 py-2 text-sm text-cyan-50 outline-none placeholder:text-cyan-100/50 focus:border-cyan-100/45"
      disabled={disabled}
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      type={type ?? "text"}
      value={value}
    />
  );
}

function Select({
  disabled,
  onChange,
  options,
  value,
}: {
  value: string;
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  onChange(value: string): void;
}) {
  const selectedOptionLabel = options.find((option) => option.value === value)?.label ?? "";
  const emptyOptionValue = "__cw_empty_select_value__";
  const normalizedValue = value === "" ? emptyOptionValue : value;

  return (
    <UiSelect
      disabled={disabled}
      onValueChange={(nextValue) => onChange(nextValue === emptyOptionValue ? "" : nextValue)}
      value={normalizedValue}
    >
      <UiSelectTrigger title={selectedOptionLabel}>
        <UiSelectValue placeholder={selectedOptionLabel} />
      </UiSelectTrigger>
      <UiSelectContent>
        {options.map((option) => (
          <UiSelectItem
            key={option.value}
            value={option.value === "" ? emptyOptionValue : option.value}
          >
            {option.label}
          </UiSelectItem>
        ))}
      </UiSelectContent>
    </UiSelect>
  );
}

function InlineError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p className="mt-3 rounded-xl border border-rose-300/35 bg-rose-300/15 px-3 py-2 text-sm text-rose-100">
      {message}
    </p>
  );
}

export function InventoryPanel() {
  const { address } = usePrivyWallet();
  const assets = useAppStore((state) => state.portfolio.assets);

  return (
    <PanelFrame
      subtitle="Token balances currently visible to your avatar and minion system."
      title="Inventory"
    >
      <p className="text-sm text-cyan-100/70 text-pretty">
        Wallet {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "not connected"}.
      </p>
      <div className="space-y-2">
        {assets.length === 0 ? (
          <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/70 text-pretty">
            No assets loaded yet. Connect a wallet and open the world to hydrate balances.
          </p>
        ) : (
          assets.slice(0, 8).map((asset) => (
            <div
              key={`${asset.chain}:${asset.address}`}
              className="flex items-center justify-between rounded-xl border border-cyan-100/15 bg-cyan-50/8 px-3 py-1.5"
            >
              <div>
                <p className="font-medium text-cyan-50">{asset.symbol}</p>
                <p className="text-xs text-cyan-100/65">{asset.chain}</p>
              </div>
              <div className="text-right tabular-nums">
                <p>{asset.balance}</p>
                <p className="text-xs text-cyan-100/65">${asset.usdValue.toFixed(2)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </PanelFrame>
  );
}

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
        ? formatDisplayAmount(selectedMinion.balance, 6)
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
    ? formatDisplayAmount(selectedSendAsset.balance, 6)
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
        ? formatDisplayAmount(selectedMinion.balance, 6)
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
      if (selectedSourceAddress !== "native") {
        throw new Error("Only ETH source swaps are enabled right now");
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
  const sourceIsSwappable = selectedSourceAddress === "native";
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
      return "Selected source token is not swappable yet.";
    }
    if (!amountIsValid) {
      return "Enter a valid amount (e.g. 0.001).";
    }
    if (!selectedRoute) {
      return "Destination token is not available in current swap routes.";
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
    return formatDisplayAmount(selectedMinion.balance, 6);
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
          Selected minion token is not supported as swap input yet. Choose your ETH minion for now.
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

export function BridgePanel() {
  const { address, wallet } = usePrivyWallet();
  const activeChain = useAppStore((state) => state.session.activeChain);
  const setInteractionStatus = useAppStore((state) => state.setInteractionStatus);
  const assets = useAppStore((state) => state.portfolio.assets);
  const minions = useAppStore((state) => state.minions.list);
  const jobs = useAppStore((state) => state.pendingTransactions.jobs);
  const setPendingJobs = useAppStore((state) => state.setPendingJobs);
  const queryClient = useQueryClient();
  const registry = runtimeConfig.protocolRegistry;

  const sourceChain = activeChain;
  const destinationChain: "ethereum" | "base" = activeChain === "ethereum" ? "base" : "ethereum";
  const [assetAddress, setAssetAddress] = useState<string | "native">("native");
  const [amount, setAmount] = useState("0.005");
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
    chainId: submittedTx ? runtimeConfig.chains[submittedTx.chain].chainId : undefined,
    hash: submittedTx?.hash,
    query: {
      enabled: Boolean(submittedTx),
    },
  });

  const bridgeEntry = useMemo(
    () => getBridgeRegistryEntry(registry),
    [registry],
  );
  const bridgeableAssets = useMemo(() => {
    const supported = new Set(
      (bridgeEntry?.supportedTokens ?? [])
        .filter((token) => token.chain === sourceChain)
        .map((token) => toAssetKey(token.chain, token.address))
        .filter((key): key is string => Boolean(key)),
    );

    return assets.filter((asset) => {
      const key = toAssetKey(asset.chain, typeof asset.address === "string" ? asset.address : undefined);
      return key ? supported.has(key) : false;
    });
  }, [assets, bridgeEntry?.supportedTokens, sourceChain]);
  const selectedBridgeAsset = useMemo(
    () => bridgeableAssets.find((asset) => asset.address === assetAddress),
    [assetAddress, bridgeableAssets],
  );
  const minionAssetKeys = useMemo(
    () =>
      new Set(
        minions
          .map((minion) =>
            typeof minion.assetKey === "string" ? minion.assetKey.toLowerCase() : undefined,
          )
          .filter((key): key is string => Boolean(key)),
      ),
    [minions],
  );

  useEffect(() => {
    if (!bridgeableAssets.length) {
      setAssetAddress("native");
      return;
    }
    if (!bridgeableAssets.some((asset) => asset.address === assetAddress)) {
      setAssetAddress(bridgeableAssets[0]!.address);
    }
  }, [assetAddress, bridgeableAssets]);

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
      if (sourceChain === destinationChain) {
        throw new Error("Source and destination chains must differ");
      }
      if (!selectedBridgeAsset) {
        throw new Error("No bridgeable asset is available on this chain");
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
      await queryClient.invalidateQueries({ queryKey: ["wallet-chain", wallet?.address] });
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
  const bridgeBusy = startMutation.isPending || switchChainMutation.isPending || waitForBridgeReceipt.isLoading;

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
          await refreshPortfolioAfterInteraction(queryClient, address, [sourceChain, destinationChain]);
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
    queryClient,
    setInteractionStatus,
    setPendingJobs,
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
    if (!bridgeBusy && sourceChain !== destinationChain && amount && selectedBridgeAsset) {
      startMutation.mutate();
    }
  };
  const walletChain = walletChainQuery.data;
  const walletNeedsSwitch = Boolean(walletChain && walletChain !== sourceChain);
  const bridgeErrors = useMemo(
    () =>
      [...new Set(
        [
          startMutation.error?.message,
          switchChainMutation.error?.message,
          refreshMutation.error?.message,
          waitForBridgeReceipt.error?.message,
        ].filter((message): message is string => Boolean(message)),
      )],
    [
      refreshMutation.error?.message,
      startMutation.error?.message,
      switchChainMutation.error?.message,
      waitForBridgeReceipt.error?.message,
    ],
  );
  const recentJobs = jobs.slice(0, 2);

  return (
    <PanelFrame subtitle="Select a token and amount, then bridge now." title="Bridge">
      <form
        className="space-y-2.5"
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
              value={sourceChain === "ethereum" ? "Ethereum" : "Base"}
            />
          </Field>
          <Field label="Destination chain">
            <Input
              disabled
              onChange={() => undefined}
              readOnly
              value={destinationChain === "ethereum" ? "Ethereum" : "Base"}
            />
          </Field>
        </div>
          <Field label="Token / Minion">
          <Select
            disabled={bridgeBusy}
            onChange={(value) => setAssetAddress(value as string | "native")}
            options={
              bridgeableAssets.length
                ? bridgeableAssets.map((asset) => ({
                    label: `${asset.symbol} · ${formatDisplayAmount(asset.balance)}${
                      minionAssetKeys.has(
                        toAssetKey(
                          asset.chain,
                          typeof asset.address === "string" ? asset.address : undefined,
                        ) ?? "",
                      )
                        ? " · Minion"
                        : ""
                    }`,
                    value: asset.address,
                  }))
                : [{ label: "No bridgeable assets on this chain", value: "native" }]
            }
            value={assetAddress}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="Amount">
            <Input disabled={bridgeBusy} inputMode="decimal" onChange={setAmount} type="number" value={amount} />
          </Field>
          <div className="self-end rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-xs text-cyan-100/75 tabular-nums">
            {sourceChain === "ethereum" ? "Ethereum" : "Base"} to{" "}
            {destinationChain === "ethereum" ? "Ethereum" : "Base"}
          </div>
        </div>
        {walletNeedsSwitch ? (
          <ActionButton
            className="mt-1"
            disabled={bridgeBusy}
            onClick={() => switchChainMutation.mutate()}
          >
            <span className="block text-xs text-cyan-100/70">Wallet network</span>
            <span className="mt-0.5 block text-base">Switch to {chainLabel(sourceChain)}</span>
          </ActionButton>
        ) : null}

        <ActionButton
          buttonType="submit"
          className="mt-1"
          disabled={
            bridgeBusy ||
            sourceChain === destinationChain ||
            !amount ||
            bridgeableAssets.length === 0
          }
        >
          <span className="block text-base">
            {waitForBridgeReceipt.isLoading ? "Confirming transaction..." : "Bridge now"}
          </span>
        </ActionButton>
      </form>

      <div className="space-y-1.5">
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
              <p className="text-xs text-cyan-100/55">depositId: {job.depositId ?? "pending"}</p>
            </button>
          ))
        )}
      </div>

      {bridgeErrors.map((message) => (
        <InlineError key={message} message={message} />
      ))}
    </PanelFrame>
  );
}

export function JobsPanel() {
  const { address } = usePrivyWallet();
  const jobs = useAppStore((state) => state.pendingTransactions.jobs);
  const summary = useMemo(
    () => runtimeConfig.protocolRegistry.map((entry) => `${entry.label}: ${entry.chainSupport.join(", ")}`),
    [],
  );
  const recentJobs = jobs.slice(0, 4);

  return (
    <PanelFrame
      subtitle="Readable snapshot of active protocol integrations and pending transaction jobs."
      title="Protocol Ledger"
    >
      <p className="text-sm text-cyan-100/70 text-pretty">
        Active address: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "none"}.
      </p>
      <div className="space-y-1.5">
        {summary.slice(0, 3).map((line) => (
          <p
            key={line}
            className="rounded-xl border border-cyan-100/15 bg-cyan-50/8 px-3 py-1.5 text-xs text-cyan-50"
          >
            {line}
          </p>
        ))}
      </div>
      <div className="space-y-1.5">
        {recentJobs.length === 0 ? (
          <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/70 text-pretty">
            No pending transaction jobs.
          </p>
        ) : (
          recentJobs.map((job) => (
            <p
              key={job.id}
              className="rounded-xl border border-cyan-100/15 bg-cyan-50/8 px-3 py-1.5 text-xs text-cyan-50"
            >
              {job.protocol ?? "bridge"} · {job.depositId ?? job.id} · {job.status}
            </p>
          ))
        )}
      </div>
    </PanelFrame>
  );
}
