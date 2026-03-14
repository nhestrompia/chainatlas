import type * as Party from "partykit/server";
import {
  clientMessageSchema,
  type InteractionStatus,
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

  constructor(readonly party: Party.Party) {}

  onConnect(connection: Party.Connection<PresenceConnectionState>) {
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
        },
      }),
    );
  }

  onMessage(rawMessage: string, sender: Party.Connection<PresenceConnectionState>) {
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
}
