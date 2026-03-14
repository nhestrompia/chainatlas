import type * as Party from "partykit/server";
import {
  clientMessageSchema,
  type InteractionStatus,
  type PresenceSnapshot,
  type ServerMessage,
  type TokenMinion,
} from "@cryptoworld/shared";

type PresenceConnectionState = {
  snapshot: PresenceSnapshot;
  lastUpdateAt: number;
};

const THROTTLE_MS = 50;
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

function cloneMinions(snapshot: { minions?: ReadonlyArray<TokenMinion> }) {
  return snapshot.minions?.map((minion) => ({ ...minion }));
}

export default class CryptoWorldRoom implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };

  constructor(readonly party: Party.Party) {}

  onConnect(connection: Party.Connection<PresenceConnectionState>) {
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
                minions: cloneMinions(item.state.snapshot),
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

      if (message.type === "presence:update" && previous && now - previous.lastUpdateAt < THROTTLE_MS) {
        return;
      }

      const snapshot: PresenceSnapshot = {
        ...message.payload,
        minions: message.payload.minions ?? previous?.snapshot.minions,
        position: {
          x: clamp(message.payload.position.x, BOUNDS.minX, BOUNDS.maxX),
          y: message.payload.position.y,
          z: clamp(message.payload.position.z, BOUNDS.minZ, BOUNDS.maxZ),
        },
        updatedAt: now,
      };
      const broadcastSnapshot: PresenceSnapshot = message.payload.minions
        ? snapshot
        : {
            ...snapshot,
            minions: undefined,
          };

      sender.setState({ snapshot, lastUpdateAt: now });
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
        minions: cloneMinions(state.snapshot),
        updatedAt: Date.now(),
      };

      sender.setState({ snapshot, lastUpdateAt: Date.now() });
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
