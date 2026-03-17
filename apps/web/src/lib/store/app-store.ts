import { create } from "zustand";
import {
  WORLD_CONFIG,
  type BridgeJob,
  type InteractionStatus,
  type MerchantShop,
  type OverlaySlice,
  type PortfolioAsset,
  type PresenceSnapshot,
  type SessionSlice,
  type TokenMinion,
  type WorldRoomId,
} from "@chainatlas/shared";

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
  merchants: {
    shops: Record<string, MerchantShop>;
  };
  overlays: OverlaySlice;
  pendingTransactions: {
    jobs: BridgeJob[];
  };
  partySocket?: WebSocket;
  setWallet(address?: string): void;
  setRoom(roomId: WorldRoomId): void;
  setOverlay(activeOverlay?: OverlaySlice["activeOverlay"], nearbyTarget?: string): void;
  setSwapSelection(assetKey?: string): void;
  setSwapStep(step: OverlaySlice["swapStep"]): void;
  setSendSelection(assetKey?: string): void;
  setSendStep(step: OverlaySlice["sendStep"]): void;
  setBridgeSelection(assetKey?: string): void;
  setBridgeStep(step: OverlaySlice["bridgeStep"]): void;
  setNearbyTarget(nearbyTarget?: string): void;
  setNearbyMerchantSeller(seller?: string): void;
  setMerchantTab(tab: NonNullable<OverlaySlice["merchantTab"]>): void;
  setMerchantMode(mode: NonNullable<OverlaySlice["merchantMode"]>): void;
  setMerchantSelectedListingId(listingId?: string): void;
  setPresenceStatus(status: AppState["presence"]["status"]): void;
  setLocalPresence(snapshot: PresenceSnapshot): void;
  setLocalShout(text?: string, expiresAt?: number): void;
  clearLocalPresence(): void;
  hydrateRemotePresence(remote: Record<string, PresenceSnapshot>): void;
  clearRemotePresence(): void;
  upsertRemotePresence(connectionId: string, snapshot: PresenceSnapshot): void;
  removeRemotePresence(connectionId: string): void;
  hydrateMerchants(shops: MerchantShop[]): void;
  upsertMerchantShop(shop: MerchantShop): void;
  removeMerchantListing(seller: string, listingId: string): void;
  clearMerchants(): void;
  hydratePortfolio(assets: PortfolioAsset[]): void;
  hydrateMinions(minions: TokenMinion[], total: number, visibleSymbols: string[]): void;
  setPendingJobs(jobs: BridgeJob[]): void;
  setInteractionStatus(status: InteractionStatus): void;
  setPartySocket(socket?: WebSocket): void;
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
  merchants: {
    shops: {},
  },
  overlays: {},
  pendingTransactions: {
    jobs: [],
  },
  partySocket: undefined,
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
        nearbyTarget:
          activeOverlay === "merchant"
            ? state.overlays.nearbyTarget
            : nearbyTarget ?? state.overlays.nearbyTarget,
        nearbyMerchantSeller:
          activeOverlay === "merchant"
            ? nearbyTarget ?? state.overlays.nearbyMerchantSeller
            : undefined,
        merchantTab:
          activeOverlay === "merchant"
            ? state.overlays.activeOverlay === "merchant"
              ? state.overlays.merchantTab ?? "browse"
              : "browse"
            : undefined,
        merchantMode:
          activeOverlay === "merchant"
            ? state.overlays.merchantMode ?? "clone"
            : undefined,
        merchantSelectedListingId:
          activeOverlay === "merchant"
            ? state.overlays.merchantSelectedListingId
            : undefined,
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
        bridgeSelectedAssetKey:
          activeOverlay === "bridge"
            ? state.overlays.bridgeSelectedAssetKey
            : undefined,
        bridgeStep:
          activeOverlay === "bridge"
            ? state.overlays.activeOverlay === "bridge"
              ? state.overlays.bridgeStep ?? "select"
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
  setBridgeSelection(assetKey) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        bridgeSelectedAssetKey: assetKey,
      },
    }));
  },
  setBridgeStep(step) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        bridgeStep: step,
      },
    }));
  },
  setNearbyTarget(nearbyTarget) {
    set((state) => {
      if (
        state.overlays.activeOverlay === "chat" ||
        state.overlays.activeOverlay === "player" ||
        state.overlays.activeOverlay === "send" ||
        state.overlays.activeOverlay === "merchant"
      ) {
        return state;
      }
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
  setNearbyMerchantSeller(seller) {
    set((state) => {
      if (state.overlays.nearbyMerchantSeller === seller) {
        return state;
      }
      return {
        overlays: {
          ...state.overlays,
          nearbyMerchantSeller: seller,
        },
      };
    });
  },
  setMerchantTab(tab) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        merchantTab: tab,
      },
    }));
  },
  setMerchantMode(mode) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        merchantMode: mode,
      },
    }));
  },
  setMerchantSelectedListingId(listingId) {
    set((state) => ({
      overlays: {
        ...state.overlays,
        merchantSelectedListingId: listingId,
      },
    }));
  },
  hydrateMerchants(shops) {
    const next = shops.reduce<Record<string, MerchantShop>>((accumulator, shop) => {
      accumulator[shop.seller.toLowerCase()] = shop;
      return accumulator;
    }, {});
    set({
      merchants: {
        shops: next,
      },
    });
  },
  upsertMerchantShop(shop) {
    set((state) => ({
      merchants: {
        shops: {
          ...state.merchants.shops,
          [shop.seller.toLowerCase()]: shop,
        },
      },
    }));
  },
  removeMerchantListing(seller, listingId) {
    set((state) => {
      const key = seller.toLowerCase();
      const current = state.merchants.shops[key];
      if (!current) {
        return state;
      }
      if (listingId === "*") {
        const nextShops = { ...state.merchants.shops };
        delete nextShops[key];
        return {
          merchants: {
            shops: nextShops,
          },
        };
      }
      const nextListings = current.listings.filter((listing) => listing.listingId !== listingId);
      if (nextListings.length === 0) {
        const nextShops = { ...state.merchants.shops };
        delete nextShops[key];
        return {
          merchants: {
            shops: nextShops,
          },
        };
      }
      return {
        merchants: {
          shops: {
            ...state.merchants.shops,
            [key]: {
              ...current,
              listings: nextListings,
              updatedAt: Date.now(),
            },
          },
        },
      };
    });
  },
  clearMerchants() {
    set({
      merchants: {
        shops: {},
      },
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
  setLocalShout(text, expiresAt) {
    set((state) => {
      if (!state.presence.local) {
        return state;
      }
      const normalizedText = typeof text === "string" ? text.trim() : "";
      if (!normalizedText || typeof expiresAt !== "number" || expiresAt <= Date.now()) {
        return {
          presence: {
            ...state.presence,
            local: {
              ...state.presence.local,
              shoutText: undefined,
              shoutExpiresAt: undefined,
              updatedAt: Date.now(),
            },
          },
        };
      }
      return {
        presence: {
          ...state.presence,
          local: {
            ...state.presence.local,
            shoutText: normalizedText,
            shoutExpiresAt: expiresAt,
            updatedAt: Date.now(),
          },
        },
      };
    });
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
  setPartySocket(socket) {
    set({ partySocket: socket });
  },
}));
