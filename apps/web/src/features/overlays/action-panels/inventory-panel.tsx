import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { useAppStore } from "@/lib/store/app-store";
import { PanelFrame, formatDisplayAmount } from "./shared";

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
                <p className="max-w-[180px] truncate font-medium text-cyan-50" title={asset.symbol}>
                  {asset.symbol}
                </p>
                <p className="text-xs text-cyan-100/65">{asset.chain}</p>
              </div>
              <div className="text-right tabular-nums">
                <p>{formatDisplayAmount(asset.balance)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </PanelFrame>
  );
}
