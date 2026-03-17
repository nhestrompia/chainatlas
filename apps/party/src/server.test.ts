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
  const storageMap = new Map<string, unknown>();
  return {
    id: "ethereum:main",
    storage: {
      get: async (key: string) => storageMap.get(key),
      put: async (key: string, value: unknown) => {
        storageMap.set(key, value);
      },
      delete: async (key: string) => {
        storageMap.delete(key);
      },
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
  it("broadcasts a join on valid presence init", async () => {
    const party = createParty();
    const room = new ChainAtlasRoom(party as never);
    const connection = createConnection("conn_1");
    party.addConnection(connection);

    await room.onConnect(connection as never);
    await room.onMessage(
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

  it("keeps websocket connection state lightweight when init includes minions", async () => {
    const party = createParty();
    const room = new ChainAtlasRoom(party as never);
    const connection = createConnection("conn_2");
    party.addConnection(connection);

    await room.onConnect(connection as never);
    await room.onMessage(
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

  it("includes merchant shops in room snapshot and enforces five-listing cap", async () => {
    const party = createParty();
    const room = new ChainAtlasRoom(party as never);
    const connection = createConnection("conn_3");
    party.addConnection(connection);

    await room.onConnect(connection as never);
    await room.onMessage(
      JSON.stringify({
        type: "presence:init",
        payload: {
          address: "0x000000000000000000000000000000000000dEaD",
          roomId: "ethereum:main",
          displayName: "merchant",
          avatarId: "navigator",
          chain: "ethereum",
          interactionStatus: "exploring",
          minionSummary: { total: 0, visibleSymbols: [] },
          position: { x: -10, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          updatedAt: Date.now(),
        },
      }),
      connection as never,
    );

    await room.onMessage(
      JSON.stringify({
        type: "merchant:upsert-shop",
        payload: {
          shop: {
            seller: "0x000000000000000000000000000000000000dEaD",
            chain: "ethereum",
            roomId: "ethereum:main",
            mode: "clone",
            anchor: { x: -12, y: 1, z: 8 },
            updatedAt: Date.now(),
            listings: Array.from({ length: 5 }, (_, index) => ({
              listingId: `listing_${index}`,
              source: "chainatlas",
              status: "active",
              seller: "0x000000000000000000000000000000000000dEaD",
              chain: "ethereum",
              nftContract: "0x000000000000000000000000000000000000bEEF",
              tokenId: String(index + 1),
              collectionName: "Collection",
              tokenName: `Item #${index + 1}`,
              priceWei: "100000000000000000",
              currencySymbol: "ETH",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })),
          },
        },
      }),
      connection as never,
    );

    const upsertMessage = connection.sent.findLast((message) =>
      message.includes("merchant:upserted"),
    );
    expect(upsertMessage).toBeDefined();
    const parsed = JSON.parse(upsertMessage ?? "{}") as {
      payload?: { shop?: { listings?: unknown[] } };
    };
    expect(parsed.payload?.shop?.listings?.length).toBe(5);
  });
});
