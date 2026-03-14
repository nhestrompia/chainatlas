import { useMemo } from "react";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { runtimeConfig } from "@/lib/config/runtime";
import { useAppStore } from "@/lib/store/app-store";
import { PanelFrame } from "./shared";

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
