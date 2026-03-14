import { create } from "zustand";
import { WORLD_CONFIG, type BridgeJob, type InteractionStatus, type OverlaySlice, type PortfolioAsset, type PresenceSnapshot, type SessionSlice, type TokenMinion, type WorldRoomId } from "@cryptoworld/shared";

type AppState = {
  session: SessionSlice;
  presence: {
    local?: PresenceSnapshot;
    remote: Record<string, PresenceSnapshot>;
    status: "disconnected" | "connecting" | "connected";
  };
  portfolio: {
    assets: PortfolioAsset[];
    loading: boolean;
    refreshedAt?: number;
  };
  minions: {
    list: TokenMinion[];
    total: number;
    visibleSymbols: string[];
  };
  overlays: OverlaySlice;
  pendingTransactions: {
    jobs: BridgeJob[];
  };
  setWallet(address?: string): void;
  setRoom(roomId: WorldRoomId): void;
  setOverlay(activeOverlay?: OverlaySlice["activeOverlay"], nearbyTarget?: string): void;
  setSwapSelection(assetKey?: string): void;
  setSwapStep(step: OverlaySlice["swapStep"]): void;
  setSendSelection(assetKey?: string): void;
  setSendStep(step: OverlaySlice["sendStep"]): void;
  setNearbyTarget(nearbyTarget?: string): void;
  setPresenceStatus(status: AppState["presence"]["status"]): void;
  setLocalPresence(snapshot: PresenceSnapshot): void;
  clearLocalPresence(): void;
  hydrateRemotePresence(remote: Record<string, PresenceSnapshot>): void;
  clearRemotePresence(): void;
  upsertRemotePresence(connectionId: string, snapshot: PresenceSnapshot): void;
  removeRemotePresence(connectionId: string): void;
  hydratePortfolio(assets: PortfolioAsset[]): void;
  hydrateMinions(minions: TokenMinion[], total: number, visibleSymbols: string[]): void;
  setPendingJobs(jobs: BridgeJob[]): void;
  setInteractionStatus(status: InteractionStatus): void;
};

const roomToChain: Record<WorldRoomId, SessionSlice["activeChain"]> = {
  "ethereum:main": "ethereum",
  "base:main": "base",
};

export const useAppStore = create<AppState>((set) => ({
  session: {
    activeChain: "ethereum",
    currentRoomId: WORLD_CONFIG.defaultRoomId,
    walletConnected: false,
  },
  presence: {
    remote: {},
    status: "disconnected",
  },
  portfolio: {
    assets: [],
    loading: false,
  },
  minions: {
    list: [],
    total: 0,
    visibleSymbols: [],
  },
  overlays: {},
  pendingTransactions: {
    jobs: [],
  },
  setWallet(address) {
    set((state) => ({
      session: {
        ...state.session,
        connectedAddress: address,
        walletConnected: Boolean(address),
      },
    }));
  },
  setRoom(roomId) {
    set((state) => ({
      session: {
        ...state.session,
        currentRoomId: roomId,
        activeChain: roomToChain[roomId],
      },
    }));
  },
  setOverlay(activeOverlay, nearbyTarget) {
    set((state) => ({
      overlays: {
        activeOverlay,
        nearbyTarget: nearbyTarget ?? state.overlays.nearbyTarget,
        swapSelectedAssetKey:
          activeOverlay === "swap" ? state.overlays.swapSelectedAssetKey : undefined,
        swapStep:
          activeOverlay === "swap"
            ? state.overlays.activeOverlay === "swap"
              ? state.overlays.swapStep ?? "select"
              : "select"
            : undefined,
        sendSelectedAssetKey:
          activeOverlay === "send" ? state.overlays.sendSelectedAssetKey : undefined,
        sendStep:
          activeOverlay === "send"
            ? state.overlays.activeOverlay === "send"
              ? state.overlays.sendStep ?? "select"
              : "select"
            : undefined,
      },
    }));
  },
  setSwapSelection(assetKey) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        swapSelectedAssetKey: assetKey,
      },
    }));
  },
  setSwapStep(step) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        swapStep: step,
      },
    }));
  },
  setSendSelection(assetKey) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        sendSelectedAssetKey: assetKey,
      },
    }));
  },
  setSendStep(step) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        sendStep: step,
      },
    }));
  },
  setNearbyTarget(nearbyTarget) {
    set((state) => {
      if (state.overlays.nearbyTarget === nearbyTarget) {
        return state;
      }
      return {
        overlays: {
          ...state.overlays,
          nearbyTarget,
        },
      };
    });
  },
  setPresenceStatus(status) {
    set((state) => {
      if (state.presence.status === status) {
        return state;
      }
      return {
        presence: {
          ...state.presence,
          status,
        },
      };
    });
  },
  setLocalPresence(snapshot) {
    set((state) => ({
      presence: {
        ...state.presence,
        local: snapshot,
      },
    }));
  },
  clearLocalPresence() {
    set((state) => ({
      presence: {
        ...state.presence,
        local: undefined,
      },
    }));
  },
  hydrateRemotePresence(remote) {
    set((state) => ({
      presence: {
        ...state.presence,
        remote,
      },
    }));
  },
  clearRemotePresence() {
    set((state) => ({
      presence: {
        ...state.presence,
        remote: {},
      },
    }));
  },
  upsertRemotePresence(connectionId, snapshot) {
    set((state) => {
      const previous = state.presence.remote[connectionId];
      const mergedSnapshot =
        snapshot.minions === undefined && previous?.minions
          ? {
              ...snapshot,
              minions: previous.minions,
            }
          : snapshot;

      if (previous?.updatedAt === mergedSnapshot.updatedAt) {
        return state;
      }

      return {
        presence: {
          ...state.presence,
          remote: {
            ...state.presence.remote,
            [connectionId]: mergedSnapshot,
          },
        },
      };
    });
  },
  removeRemotePresence(connectionId) {
    set((state) => {
      const remote = { ...state.presence.remote };
      delete remote[connectionId];
      return {
        presence: {
          ...state.presence,
          remote,
        },
      };
    });
  },
  hydratePortfolio(assets) {
    set({
      portfolio: {
        assets,
        loading: false,
        refreshedAt: Date.now(),
      },
    });
  },
  hydrateMinions(minions, total, visibleSymbols) {
    set({
      minions: {
        list: minions,
        total,
        visibleSymbols,
      },
    });
  },
  setPendingJobs(jobs) {
    set({
      pendingTransactions: { jobs },
    });
  },
  setInteractionStatus(status) {
    set((state) => ({
      presence: state.presence.local
        ? {
            ...state.presence,
            local: {
              ...state.presence.local,
              interactionStatus: status,
              updatedAt: Date.now(),
            },
          }
        : state.presence,
    }));
  },
}));
