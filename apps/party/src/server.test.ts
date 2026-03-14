import { describe, expect, it } from "vitest";
import ChainAtlasRoom from "./server";

function createConnection(id: string) {
  const sent: string[] = [];
  return {
    id,
    sent,
    state: null as any,
    send(message: string) {
      sent.push(message);
    },
    setState(value: any) {
      this.state = value;
    },
  };
}

function createParty() {
  const connections = new Map<string, ReturnType<typeof createConnection>>();
  return {
    id: "ethereum:main",
    storage: {
      put: async () => undefined,
      delete: async () => undefined,
    },
    getConnections() {
      return connections.values();
    },
    broadcast(message: string) {
      for (const connection of connections.values()) {
        connection.send(message);
      }
    },
    addConnection(connection: ReturnType<typeof createConnection>) {
      connections.set(connection.id, connection);
    },
  };
}

describe("ChainAtlasRoom", () => {
  it("broadcasts a join on valid presence init", () => {
    const party = createParty();
    const room = new ChainAtlasRoom(party as never);
    const connection = createConnection("conn_1");
    party.addConnection(connection);

    room.onConnect(connection as never);
    room.onMessage(
      JSON.stringify({
        type: "presence:init",
        payload: {
          address: "0x000000000000000000000000000000000000dEaD",
          roomId: "ethereum:main",
          displayName: "dead",
          avatarId: "navigator",
          chain: "ethereum",
          interactionStatus: "exploring",
          minionSummary: { total: 1, visibleSymbols: ["ETH"] },
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          updatedAt: Date.now(),
        },
      }),
      connection as never,
    );

    expect(connection.sent.some((message) => message.includes("presence:joined"))).toBe(true);
  });

  it("keeps websocket connection state lightweight when init includes minions", () => {
    const party = createParty();
    const room = new ChainAtlasRoom(party as never);
    const connection = createConnection("conn_2");
    party.addConnection(connection);

    room.onConnect(connection as never);
    room.onMessage(
      JSON.stringify({
        type: "presence:init",
        payload: {
          address: "0x000000000000000000000000000000000000dEaD",
          roomId: "ethereum:main",
          displayName: "dead",
          avatarId: "navigator",
          chain: "ethereum",
          interactionStatus: "exploring",
          minionSummary: {
            total: 20,
            visibleSymbols: Array.from({ length: 20 }, (_, index) => `TOKEN_${index}`),
          },
          minions: Array.from({ length: 20 }, (_, index) => ({
            name: `Token ${index}`,
            amount: "1",
          })),
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          updatedAt: Date.now(),
        },
      }),
      connection as never,
    );

    expect(connection.state?.snapshot.minions).toBeUndefined();
    expect(connection.state?.snapshot.minionSummary.visibleSymbols.length).toBeLessThanOrEqual(12);
    expect(connection.sent.some((message) => message.includes("presence:joined"))).toBe(true);
  });
});
