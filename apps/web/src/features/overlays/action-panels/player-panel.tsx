import { useMemo } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { ActionButton, PanelFrame, shortAddress } from "./shared";

export function PlayerPanel() {
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const remotePresence = useAppStore((state) => state.presence.remote);
  const setOverlay = useAppStore((state) => state.setOverlay);

  const targetLabel = useMemo(() => {
    if (!nearbyTarget) {
      return undefined;
    }
    const normalizedTarget = nearbyTarget.toLowerCase();
    const snapshot = Object.values(remotePresence).find(
      (presence) => presence.address.toLowerCase() === normalizedTarget,
    );
    return snapshot?.displayName;
  }, [nearbyTarget, remotePresence]);

  return (
    <PanelFrame
      subtitle={
        nearbyTarget
          ? "Choose what to do with the selected nearby player."
          : "Move closer to a player, then interact."
      }
      title="Player Interaction"
    >
      {!nearbyTarget ? (
        <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/70 text-pretty">
          No nearby player selected.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2">
            <p className="text-xs text-cyan-100/70">Selected player</p>
            <p className="text-sm font-semibold text-cyan-50">
              {targetLabel ?? shortAddress(nearbyTarget)}
            </p>
            <p className="mt-0.5 text-xs text-cyan-100/70">
              {shortAddress(nearbyTarget)}
            </p>
          </div>
          <ActionButton onClick={() => setOverlay("chat", nearbyTarget)}>
            Open chat
          </ActionButton>
          <ActionButton onClick={() => setOverlay("send", nearbyTarget)}>
            Send tokens
          </ActionButton>
        </>
      )}
    </PanelFrame>
  );
}
