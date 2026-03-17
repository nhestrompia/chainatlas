import { z } from "zod";
import { merchantShopSchema, presenceSnapshotSchema } from "./domain";

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("presence:init"),
    payload: presenceSnapshotSchema,
  }),
  z.object({
    type: z.literal("presence:update"),
    payload: presenceSnapshotSchema,
  }),
  z.object({
    type: z.literal("presence:leave"),
    payload: z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }),
  }),
  z.object({
    type: z.literal("interaction:start"),
    payload: z.object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      interactionStatus: z.enum(["sending", "swapping", "bridging"]),
    }),
  }),
  z.object({
    type: z.literal("interaction:end"),
    payload: z.object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    }),
  }),
  z.object({
    type: z.literal("merchant:upsert-shop"),
    payload: z.object({
      shop: merchantShopSchema,
    }),
  }),
  z.object({
    type: z.literal("merchant:sync-external"),
    payload: z.object({
      shop: merchantShopSchema,
    }),
  }),
  z.object({
    type: z.literal("merchant:cancel-listing"),
    payload: z.object({
      seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      listingId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("merchant:mark-fulfilled"),
    payload: z.object({
      seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      listingId: z.string().min(1),
      txHash: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
    }),
  }),
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room:snapshot"),
    payload: z.object({
      roomId: z.string(),
      connections: z.array(
        z.object({
          connectionId: z.string(),
          snapshot: presenceSnapshotSchema,
        }),
      ),
      merchants: z.array(merchantShopSchema).default([]),
    }),
  }),
  z.object({
    type: z.literal("presence:joined"),
    payload: z.object({
      connectionId: z.string(),
      snapshot: presenceSnapshotSchema,
    }),
  }),
  z.object({
    type: z.literal("presence:updated"),
    payload: z.object({
      connectionId: z.string(),
      snapshot: presenceSnapshotSchema,
    }),
  }),
  z.object({
    type: z.literal("presence:left"),
    payload: z.object({
      connectionId: z.string(),
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    }),
  }),
  z.object({
    type: z.literal("interaction:updated"),
    payload: z.object({
      connectionId: z.string(),
      interactionStatus: z.enum(["idle", "sending", "swapping", "bridging"]),
    }),
  }),
  z.object({
    type: z.literal("room:error"),
    payload: z.object({
      message: z.string(),
    }),
  }),
  z.object({
    type: z.literal("merchant:snapshot"),
    payload: z.object({
      shops: z.array(merchantShopSchema),
    }),
  }),
  z.object({
    type: z.literal("merchant:upserted"),
    payload: z.object({
      shop: merchantShopSchema,
    }),
  }),
  z.object({
    type: z.literal("merchant:listing-removed"),
    payload: z.object({
      seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      listingId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("merchant:error"),
    payload: z.object({
      message: z.string(),
    }),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
