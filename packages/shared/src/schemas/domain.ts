import { z } from "zod";

export const chainSlugSchema = z.enum(["ethereum", "base"]);
export const runtimeProfileSchema = z.enum(["testnet", "mainnet"]);
export const worldRoomIdSchema = z.enum([
  "ethereum:main",
  "base:main",
]);
export const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export const eulerSchema = vector3Schema;

export const interactionZoneSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["spawn", "swap", "bridge", "send", "district", "portal"]),
  roomId: worldRoomIdSchema,
  chain: chainSlugSchema.optional(),
  position: vector3Schema,
  size: vector3Schema,
  targetRoomId: worldRoomIdSchema.optional(),
  description: z.string().optional(),
});

export const worldConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  defaultRoomId: worldRoomIdSchema,
  spawnPosition: vector3Schema,
  availableRooms: z.array(worldRoomIdSchema),
  interactionZones: z.array(interactionZoneSchema),
});

export const portfolioAssetSchema = z.object({
  chain: chainSlugSchema,
  address: z.union([z.literal("native"), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]),
  symbol: z.string(),
  name: z.string(),
  balance: z.string(),
  decimals: z.number().int().nonnegative(),
  usdValue: z.number().nonnegative(),
  logoUrl: z.string().url().optional(),
  verified: z.boolean().optional(),
});

export const tokenMinionSchema = z.object({
  id: z.string(),
  assetKey: z.string(),
  chain: chainSlugSchema,
  symbol: z.string(),
  name: z.string(),
  balance: z.string(),
  usdValue: z.number().nonnegative(),
  hue: z.number(),
  scale: z.number(),
  orbitRadius: z.number(),
  bobOffset: z.number(),
  priority: z.number(),
  actionable: z.boolean(),
});

export const minionSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  visibleSymbols: z.array(z.string()),
});

export const avatarIdSchema = z.enum(["navigator", "warden", "sprinter", "mystic"]);

export const presenceSnapshotSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  roomId: worldRoomIdSchema,
  displayName: z.string(),
  avatarId: avatarIdSchema,
  position: vector3Schema,
  rotation: eulerSchema,
  chain: chainSlugSchema,
  interactionStatus: z.enum(["idle", "exploring", "sending", "swapping", "bridging"]),
  minionSummary: minionSummarySchema,
  minions: z.array(tokenMinionSchema).optional(),
  updatedAt: z.number().int().nonnegative(),
});

export const presenceDeltaSchema = z.object({
  connectionId: z.string(),
  snapshot: presenceSnapshotSchema,
});

export const transactionIntentSchema = z.object({
  kind: z.enum(["send-native", "send-erc20", "swap", "bridge"]),
  chain: chainSlugSchema,
  routeId: z.string().optional(),
  assetAddress: z.union([z.literal("native"), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]).optional(),
  amount: z.string(),
  targetAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  destinationChain: chainSlugSchema.optional(),
  originChainId: z.number().int().positive().optional(),
  destinationChainId: z.number().int().positive().optional(),
  quoteTimestamp: z.number().int().positive().optional(),
  slippageBps: z.number().int().nonnegative().optional(),
});

export const bridgeJobSchema = z.object({
  id: z.string(),
  protocol: z.literal("across").optional(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sourceChain: chainSlugSchema,
  destinationChain: chainSlugSchema,
  originChainId: z.number().int().positive().optional(),
  destinationChainId: z.number().int().positive().optional(),
  depositId: z.string().optional(),
  assetAddress: z.union([z.literal("native"), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]),
  amount: z.string(),
  status: z.enum([
    "idle",
    "quote_ready",
    "awaiting_signature",
    "submitted",
    "settling",
    "prove_required",
    "finalize_required",
    "completed",
    "failed",
  ]),
  txHash: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  originTxHash: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  quoteTimestamp: z.number().int().positive().optional(),
  expectedFillSeconds: z.number().int().positive().optional(),
  lastSyncedAt: z.string().datetime().optional(),
  statusDetail: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nextActionLabel: z.string().optional(),
});

export const bridgeJobPatchSchema = bridgeJobSchema
  .omit({
    id: true,
    address: true,
    sourceChain: true,
    destinationChain: true,
    amount: true,
    assetAddress: true,
    createdAt: true,
  })
  .partial()
  .extend({
    status: bridgeJobSchema.shape.status.optional(),
    updatedAt: z.string().optional(),
  });

export const swapRouteConfigSchema = z.object({
  routeId: z.string(),
  label: z.string(),
  chain: chainSlugSchema,
  enabled: z.boolean(),
  routerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  feeTier: z.number().int().positive(),
  supportsNativeIn: z.boolean(),
  inputTokenDecimals: z.number().int().nonnegative(),
  outputTokenDecimals: z.number().int().nonnegative(),
  defaultSlippageBps: z.number().int().nonnegative(),
});

export const protocolRegistryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["swap", "bridge", "send"]),
  profile: runtimeProfileSchema,
  label: z.string(),
  chainSupport: z.array(chainSlugSchema),
  supportedTokens: z.array(
    z.object({
      chain: chainSlugSchema,
      address: z.union([z.literal("native"), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]),
      symbol: z.string(),
      decimals: z.number().int().nonnegative().optional(),
    }),
  ),
  execution: z.object({
    type: z.enum(["send.native_erc20", "swap.uniswap_v3", "bridge.across"]),
    routeIds: z.array(z.string()).optional(),
    bridgeApiBaseUrl: z.string().url().optional(),
  }),
  swapRoutes: z.array(swapRouteConfigSchema).optional(),
  contractAddresses: z
    .object({
      ethereum: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      base: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    })
    .default({}),
});
