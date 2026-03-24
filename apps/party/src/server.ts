import type * as Party from "partykit/server";
import {
  clientMessageSchema,
  type InteractionStatus,
  type MerchantListing,
  type MerchantShop,
  type PresenceMinion,
  type PresenceSnapshot,
  type ServerMessage,
} from "@chainatlas/shared";

type PresenceConnectionState = {
  snapshot: PresenceSnapshot;
  lastUpdateAt: number;
  lastShoutAt?: number;
};

const THROTTLE_MS = 50;
const MAX_VISIBLE_SYMBOLS_IN_STATE = 12;
const SHOUT_MAX_CHARS = 80;
const SHOUT_COOLDOWN_MS = 3_000;
const SHOUT_MIN_DURATION_MS = 3_000;
const SHOUT_MAX_DURATION_MS = 6_000;
const MERCHANT_INDEX_STORAGE_KEY = "merchant:index";
const MERCHANT_STORAGE_PREFIX = "merchant:shop:";
const MERCHANT_LISTING_LIMIT = 8;
const BOUNDS = {
  minX: -64,
  maxX: 64,
  minZ: -64,
  maxZ: 64,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function serialize(message: ServerMessage) {
  return JSON.stringify(message);
}

function cloneMinions(snapshot: { minions?: ReadonlyArray<PresenceMinion> }) {
  return snapshot.minions?.map((minion) => ({ ...minion }));
}

function normalizeShoutText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, SHOUT_MAX_CHARS);
}

function listingDedupKey(listing: MerchantListing) {
  const orderHash = listing.orderHash?.toLowerCase();
  if (orderHash) {
    return `order:${orderHash}`;
  }
  return `listing:${listing.listingId.toLowerCase()}`;
}

function isListingActive(listing: MerchantListing, now = Date.now()) {
  if (listing.status !== "active") {
    return false;
  }
  if (typeof listing.expiry === "number" && listing.expiry <= now) {
    return false;
  }
  return true;
}

function clampListings(listings: MerchantListing[], now = Date.now()) {
  const deduped = new Map<string, MerchantListing>();
  for (const listing of listings) {
    if (!isListingActive(listing, now)) {
      continue;
    }
    deduped.set(listingDedupKey(listing), listing);
  }
  return [...deduped.values()]
    .sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      return a.listingId.localeCompare(b.listingId);
    })
    .slice(0, MERCHANT_LISTING_LIMIT);
}

function toConnectionSnapshot(snapshot: PresenceSnapshot, now = Date.now()): PresenceSnapshot {
  const hasActiveShout =
    typeof snapshot.shoutText === "string" &&
    typeof snapshot.shoutExpiresAt === "number" &&
    snapshot.shoutExpiresAt > now;
  return {
    ...snapshot,
    minionSummary: {
      ...snapshot.minionSummary,
      visibleSymbols: snapshot.minionSummary.visibleSymbols.slice(0, MAX_VISIBLE_SYMBOLS_IN_STATE),
    },
    // Keep websocket attachment small. Full minions stay in storage/in-memory map.
    minions: undefined,
    shoutText: hasActiveShout ? snapshot.shoutText : undefined,
    shoutExpiresAt: hasActiveShout ? snapshot.shoutExpiresAt : undefined,
  };
}

export default class ChainAtlasRoom implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };
  private readonly liveMinionsByConnectionId = new Map<string, PresenceMinion[]>();
  private readonly merchantShopsBySeller = new Map<string, MerchantShop>();
  private merchantsLoadPromise?: Promise<void>;

  constructor(readonly party: Party.Party) {}

  async onConnect(connection: Party.Connection<PresenceConnectionState>) {
    await this.ensureMerchantsLoaded();
    const now = Date.now();
    const connections = [...this.party.getConnections<PresenceConnectionState>()].flatMap((item) =>
      item.state
        ? [
            {
              connectionId: item.id,
              snapshot: {
                ...item.state.snapshot,
                minionSummary: {
                  ...item.state.snapshot.minionSummary,
                  visibleSymbols: [...item.state.snapshot.minionSummary.visibleSymbols],
                },
                minions: cloneMinions({
                  minions: this.liveMinionsByConnectionId.get(item.id),
                }),
                shoutText:
                  item.state.snapshot.shoutText &&
                  item.state.snapshot.shoutExpiresAt &&
                  item.state.snapshot.shoutExpiresAt > now
                    ? item.state.snapshot.shoutText
                    : undefined,
                shoutExpiresAt:
                  item.state.snapshot.shoutText &&
                  item.state.snapshot.shoutExpiresAt &&
                  item.state.snapshot.shoutExpiresAt > now
                    ? item.state.snapshot.shoutExpiresAt
                    : undefined,
              },
            },
          ]
        : [],
    );

    connection.send(
      serialize({
        type: "room:snapshot",
        payload: {
          roomId: this.party.id,
          connections,
          merchants: this.getSerializedMerchants(now),
        },
      }),
    );
  }

  async onMessage(rawMessage: string, sender: Party.Connection<PresenceConnectionState>) {
    let payload: unknown;

    try {
      payload = JSON.parse(rawMessage);
    } catch {
      sender.send(
        serialize({
          type: "room:error",
          payload: { message: "Invalid message payload" },
        }),
      );
      return;
    }

    const parsed = clientMessageSchema.safeParse(payload);

    if (!parsed.success) {
      sender.send(
        serialize({
          type: "room:error",
          payload: { message: "Invalid message payload" },
        }),
      );
      return;
    }

    const message = parsed.data;
    await this.ensureMerchantsLoaded();

    if (message.type === "presence:init" || message.type === "presence:update") {
      const now = Date.now();
      const previous = sender.state;
      const previousMinions = this.liveMinionsByConnectionId.get(sender.id);
      const previousShoutActive =
        previous?.snapshot.shoutText &&
        previous.snapshot.shoutExpiresAt &&
        previous.snapshot.shoutExpiresAt > now
          ? {
              text: previous.snapshot.shoutText,
              expiresAt: previous.snapshot.shoutExpiresAt,
            }
          : undefined;

      if (message.type === "presence:update" && previous && now - previous.lastUpdateAt < THROTTLE_MS) {
        return;
      }

      const minions = message.payload.minions ?? previousMinions;
      if (minions) {
        this.liveMinionsByConnectionId.set(sender.id, cloneMinions({ minions }) ?? []);
      }

      const requestedShoutText = normalizeShoutText(message.payload.shoutText);
      const requestedShoutExpiresAt = message.payload.shoutExpiresAt;
      let shoutText = previousShoutActive?.text;
      let shoutExpiresAt = previousShoutActive?.expiresAt;
      let lastShoutAt = previous?.lastShoutAt;

      if (requestedShoutText) {
        const canShout =
          !previous?.lastShoutAt || now - previous.lastShoutAt >= SHOUT_COOLDOWN_MS;
        if (canShout) {
          const requestedDurationMs =
            typeof requestedShoutExpiresAt === "number" &&
            Number.isFinite(requestedShoutExpiresAt)
              ? requestedShoutExpiresAt - now
              : 4_000;
          const clampedDurationMs = clamp(
            requestedDurationMs,
            SHOUT_MIN_DURATION_MS,
            SHOUT_MAX_DURATION_MS,
          );
          shoutText = requestedShoutText;
          shoutExpiresAt = now + clampedDurationMs;
          lastShoutAt = now;
        }
      }

      const snapshot: PresenceSnapshot = {
        ...message.payload,
        minions,
        shoutText,
        shoutExpiresAt,
        position: {
          x: clamp(message.payload.position.x, BOUNDS.minX, BOUNDS.maxX),
          y: message.payload.position.y,
          z: clamp(message.payload.position.z, BOUNDS.minZ, BOUNDS.maxZ),
        },
        updatedAt: now,
      };
      const connectionSnapshot = toConnectionSnapshot(snapshot, now);
      const broadcastSnapshot: PresenceSnapshot = message.payload.minions
        ? snapshot
        : connectionSnapshot;

      sender.setState({ snapshot: connectionSnapshot, lastUpdateAt: now, lastShoutAt });
      this.party.storage.put(`presence:${sender.id}`, snapshot);

      this.party.broadcast(
        serialize({
          type: previous ? "presence:updated" : "presence:joined",
          payload: {
            connectionId: sender.id,
            snapshot: broadcastSnapshot,
          },
        }),
      );
      return;
    }

    if (message.type === "interaction:start" || message.type === "interaction:end") {
      const state = sender.state;
      if (!state) {
        return;
      }

      const interactionStatus: InteractionStatus =
        message.type === "interaction:end" ? "idle" : message.payload.interactionStatus;
      const snapshot: PresenceSnapshot = {
        ...state.snapshot,
        interactionStatus,
        minionSummary: {
          ...state.snapshot.minionSummary,
          visibleSymbols: [...state.snapshot.minionSummary.visibleSymbols],
        },
        minions: cloneMinions({
          minions: this.liveMinionsByConnectionId.get(sender.id),
        }),
        updatedAt: Date.now(),
      };

      sender.setState({
        snapshot: toConnectionSnapshot(snapshot),
        lastUpdateAt: Date.now(),
        lastShoutAt: state.lastShoutAt,
      });
      this.party.storage.put(`presence:${sender.id}`, snapshot);
      this.party.broadcast(
        serialize({
          type: "interaction:updated",
          payload: {
            connectionId: sender.id,
            interactionStatus,
          },
        }),
      );
      return;
    }

    if (message.type === "presence:leave") {
      this.handleLeave(sender);
      return;
    }

    if (message.type === "merchant:upsert-shop" || message.type === "merchant:sync-external") {
      const sellerAddress = sender.state?.snapshot.address?.toLowerCase();
      const incomingSeller = message.payload.shop.seller.toLowerCase();
      if (!sellerAddress || sellerAddress !== incomingSeller) {
        sender.send(
          serialize({
            type: "merchant:error",
            payload: { message: "Seller wallet mismatch for merchant update" },
          }),
        );
        return;
      }

      const normalized = this.normalizeShop(message.payload.shop);
      if (!normalized) {
        sender.send(
          serialize({
            type: "merchant:error",
            payload: { message: "Merchant shop does not match room chain" },
          }),
        );
        return;
      }

      const nextShop =
        message.type === "merchant:sync-external"
          ? this.mergeExternalListings(normalized)
          : normalized;

      if (nextShop.listings.length === 0) {
        this.merchantShopsBySeller.delete(incomingSeller);
        await this.persistMerchantShop(incomingSeller, undefined);
        this.party.broadcast(
          serialize({
            type: "merchant:listing-removed",
            payload: { seller: normalized.seller, listingId: "*" },
          }),
        );
        this.broadcastMerchantSnapshot();
        return;
      }

      this.merchantShopsBySeller.set(incomingSeller, nextShop);
      await this.persistMerchantShop(incomingSeller, nextShop);
      this.party.broadcast(
        serialize({
          type: "merchant:upserted",
          payload: { shop: nextShop },
        }),
      );
      this.broadcastMerchantSnapshot();
      return;
    }

    if (message.type === "merchant:cancel-listing") {
      const sellerAddress = sender.state?.snapshot.address?.toLowerCase();
      const payloadSeller = message.payload.seller.toLowerCase();
      if (!sellerAddress || sellerAddress !== payloadSeller) {
        sender.send(
          serialize({
            type: "merchant:error",
            payload: { message: "Only seller can cancel merchant listings" },
          }),
        );
        return;
      }

      const shop = this.merchantShopsBySeller.get(payloadSeller);
      if (!shop) {
        return;
      }
      const nextListings = shop.listings.filter((listing) => listing.listingId !== message.payload.listingId);
      if (nextListings.length === 0) {
        this.merchantShopsBySeller.delete(payloadSeller);
        await this.persistMerchantShop(payloadSeller, undefined);
      } else {
        const nextShop: MerchantShop = {
          ...shop,
          listings: nextListings,
          updatedAt: Date.now(),
        };
        this.merchantShopsBySeller.set(payloadSeller, nextShop);
        await this.persistMerchantShop(payloadSeller, nextShop);
        this.party.broadcast(
          serialize({
            type: "merchant:upserted",
            payload: { shop: nextShop },
          }),
        );
      }
      this.party.broadcast(
        serialize({
          type: "merchant:listing-removed",
          payload: {
            seller: shop.seller,
            listingId: message.payload.listingId,
          },
        }),
      );
      this.broadcastMerchantSnapshot();
      return;
    }

    if (message.type === "merchant:mark-fulfilled") {
      const payloadSeller = message.payload.seller.toLowerCase();
      const shop = this.merchantShopsBySeller.get(payloadSeller);
      if (!shop) {
        return;
      }
      const nextListings = shop.listings.filter((listing) => listing.listingId !== message.payload.listingId);
      if (nextListings.length === 0) {
        this.merchantShopsBySeller.delete(payloadSeller);
        await this.persistMerchantShop(payloadSeller, undefined);
      } else {
        const nextShop: MerchantShop = {
          ...shop,
          listings: nextListings,
          updatedAt: Date.now(),
        };
        this.merchantShopsBySeller.set(payloadSeller, nextShop);
        await this.persistMerchantShop(payloadSeller, nextShop);
        this.party.broadcast(
          serialize({
            type: "merchant:upserted",
            payload: { shop: nextShop },
          }),
        );
      }
      this.party.broadcast(
        serialize({
          type: "merchant:listing-removed",
          payload: {
            seller: shop.seller,
            listingId: message.payload.listingId,
          },
        }),
      );
      this.broadcastMerchantSnapshot();
    }
  }

  onClose(sender: Party.Connection<PresenceConnectionState>) {
    this.handleLeave(sender);
  }

  private handleLeave(sender: Party.Connection<PresenceConnectionState>) {
    const state = sender.state;
    sender.setState(null);
    this.liveMinionsByConnectionId.delete(sender.id);
    this.party.storage.delete(`presence:${sender.id}`);

    if (!state) {
      return;
    }

    this.party.broadcast(
      serialize({
        type: "presence:left",
        payload: {
          connectionId: sender.id,
          address: state.snapshot.address,
        },
      }),
    );
  }

  private getRoomChain() {
    if (this.party.id.startsWith("base:")) {
      return "base";
    }
    if (this.party.id.startsWith("polygon:")) {
      return "polygon";
    }
    return "ethereum";
  }

  private getSerializedMerchants(now = Date.now()) {
    const shops: MerchantShop[] = [];
    for (const shop of this.merchantShopsBySeller.values()) {
      const listings = clampListings(shop.listings, now);
      if (listings.length === 0) {
        continue;
      }
      shops.push({
        ...shop,
        listings,
      });
    }
    return shops;
  }

  private broadcastMerchantSnapshot() {
    this.party.broadcast(
      serialize({
        type: "merchant:snapshot",
        payload: { shops: this.getSerializedMerchants() },
      }),
    );
  }

  private normalizeShop(shop: MerchantShop): MerchantShop | undefined {
    const roomId = this.party.id as MerchantShop["roomId"];
    const chain = this.getRoomChain();
    if (shop.chain !== chain || shop.roomId !== roomId) {
      return undefined;
    }
    const now = Date.now();
    return {
      ...shop,
      chain,
      roomId,
      mode: "clone",
      updatedAt: now,
      listings: clampListings(
        shop.listings.map((listing) => ({
          ...listing,
          chain,
          seller: shop.seller,
          status: listing.status === "active" ? "active" : listing.status,
          updatedAt: listing.updatedAt || now,
          createdAt: listing.createdAt || now,
        })),
      ),
    };
  }

  private mergeExternalListings(shop: MerchantShop) {
    const sellerKey = shop.seller.toLowerCase();
    const existing = this.merchantShopsBySeller.get(sellerKey);
    if (!existing) {
      return shop;
    }

    const chainatlasListings = existing.listings.filter((listing) => listing.source === "chainatlas");
    const externalListings = shop.listings.filter((listing) => listing.source === "opensea");
    const merged: MerchantShop = {
      ...existing,
      mode: "clone",
      anchor: shop.anchor,
      updatedAt: Date.now(),
      // Keep local ChainAtlas listing metadata (image/price/order payload) when hashes collide.
      listings: clampListings([...externalListings, ...chainatlasListings]),
    };
    return merged;
  }

  private async ensureMerchantsLoaded() {
    if (!this.merchantsLoadPromise) {
      this.merchantsLoadPromise = this.loadMerchantsFromStorage();
    }
    await this.merchantsLoadPromise;
  }

  private async loadMerchantsFromStorage() {
    const rawIndex = await this.party.storage.get<string[]>(MERCHANT_INDEX_STORAGE_KEY);
    const sellerKeys = Array.isArray(rawIndex) ? rawIndex : [];
    for (const sellerKey of sellerKeys) {
      const rawShop = await this.party.storage.get<MerchantShop>(
        `${MERCHANT_STORAGE_PREFIX}${sellerKey}`,
      );
      if (!rawShop) {
        continue;
      }
      const normalized = this.normalizeShop(rawShop);
      if (!normalized || normalized.listings.length === 0) {
        continue;
      }
      this.merchantShopsBySeller.set(sellerKey, normalized);
    }
    await this.persistMerchantIndex();
  }

  private async persistMerchantIndex() {
    await this.party.storage.put(
      MERCHANT_INDEX_STORAGE_KEY,
      [...this.merchantShopsBySeller.keys()],
    );
  }

  private async persistMerchantShop(sellerKey: string, shop?: MerchantShop) {
    const storageKey = `${MERCHANT_STORAGE_PREFIX}${sellerKey}`;
    if (!shop) {
      await this.party.storage.delete(storageKey);
      await this.persistMerchantIndex();
      return;
    }
    await this.party.storage.put(storageKey, shop);
    await this.persistMerchantIndex();
  }
}
