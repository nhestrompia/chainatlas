import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { z } from "zod";
import { isAddress } from "viem";
import { runtimeConfig } from "@/lib/config/runtime";
import { formatTokenAmount } from "@/lib/utils/format-token-amount";
import { cn } from "@/lib/utils/cn";
import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@/components/ui/select";

export const courierSendSchema = z.object({
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

export const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/latest/dex/tokens";
const INTERACTION_TIMEOUT_MS = 45_000;
const XMTP_CHAT_TIMEOUT_MS = 20_000;

export const ERC20_TRANSFER_ABI = [
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

export async function withInteractionTimeout<T>(promise: Promise<T>, timeoutMessage: string) {
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

export async function withXmtpTimeout<T>(promise: Promise<T>, timeoutMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), XMTP_CHAT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export type SubmittedTx = {
  chain: "ethereum" | "base";
  hash: `0x${string}`;
};

export function toAssetKey(chain: string | undefined, address: string | undefined) {
  if (!chain || !address) {
    return undefined;
  }
  return `${chain}:${address}`.toLowerCase();
}

export function fromAssetKey(assetKey: string | undefined) {
  if (!assetKey) {
    return undefined;
  }
  const [chain, address] = assetKey.split(":");
  if (!chain || !address) {
    return undefined;
  }
  return { chain, address };
}

export function formatDisplayAmount(value: string, maximumFractionDigits = 3) {
  return formatTokenAmount(value, maximumFractionDigits);
}

export function chainLabel(chain: "ethereum" | "base") {
  return runtimeConfig.chains[chain].label;
}

export function shortHash(hash: `0x${string}`) {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function shortAddress(address?: string) {
  if (!address) {
    return "Unknown";
  }
  if (!address.startsWith("0x") || address.length < 10) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function normalizeWalletInteractionError(error: unknown) {
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

export async function refreshPortfolioAfterInteraction(
  queryClient: QueryClient,
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

export function PanelFrame({
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

export function ActionButton({
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

export function Field({
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

export function Input({
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

export function Select({
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

export function InlineError({ message, details }: { message?: string; details?: string }) {
  if (!message) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="mt-3 rounded-xl border border-rose-300/35 bg-rose-300/15 px-3 py-2 text-sm text-rose-100"
      role="alert"
    >
      <p className="font-medium text-pretty break-words">{message}</p>
      {details ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-rose-100/80">
            Technical details
          </summary>
          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-rose-100/75">
            {details}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
