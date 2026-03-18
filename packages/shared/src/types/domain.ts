export type ChainSlug = "ethereum" | "base" | "polygon";
export type RuntimeProfile = "testnet" | "mainnet";

export type ZoneKind =
  | "spawn"
  | "swap"
  | "bridge"
  | "send"
  | "district"
  | "portal"
  | "prediction";

export type WorldRoomId = "ethereum:main" | "base:main" | "polygon:main";

export type TransactionKind = "send-native" | "send-erc20" | "swap" | "bridge";
export type AvatarId = "navigator" | "warden" | "sprinter" | "mystic";

export type InteractionStatus =
  | "idle"
  | "exploring"
  | "sending"
  | "swapping"
  | "bridging";

export type BridgeJobStatus =
  | "idle"
  | "quote_ready"
  | "awaiting_signature"
  | "submitted"
  | "settling"
  | "prove_required"
  | "finalize_required"
  | "completed"
  | "failed";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface EulerLike {
  x: number;
  y: number;
  z: number;
}

export interface InteractionZone {
  id: string;
  label: string;
  kind: ZoneKind;
  roomId: WorldRoomId;
  chain?: ChainSlug;
  position: Vector3Like;
  size: Vector3Like;
  targetRoomId?: WorldRoomId;
  description?: string;
}

export interface WorldConfig {
  id: string;
  label: string;
  defaultRoomId: WorldRoomId;
  spawnPosition: Vector3Like;
  availableRooms: WorldRoomId[];
  interactionZones: InteractionZone[];
}

export interface PortfolioAsset {
  chain: ChainSlug;
  address: string | "native";
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  usdValue: number;
  logoUrl?: string;
  verified?: boolean;
}

export interface TokenMinion {
  id: string;
  assetKey: string;
  chain: ChainSlug;
  symbol: string;
  name: string;
  balance: string;
  usdValue: number;
  hue: number;
  scale: number;
  orbitRadius: number;
  bobOffset: number;
  priority: number;
  actionable: boolean;
}

export interface MinionSummary {
  total: number;
  visibleSymbols: string[];
}

export interface PresenceMinion {
  name: string;
  amount: string;
}

export interface PresenceSnapshot {
  address: string;
  roomId: WorldRoomId;
  displayName: string;
  avatarId: AvatarId;
  position: Vector3Like;
  rotation: EulerLike;
  chain: ChainSlug;
  interactionStatus: InteractionStatus;
  minionSummary: MinionSummary;
  minions?: PresenceMinion[];
  shoutText?: string;
  shoutExpiresAt?: number;
  updatedAt: number;
}

export interface PresenceDelta {
  connectionId: string;
  snapshot: PresenceSnapshot;
}

export interface TransactionIntent {
  kind: TransactionKind;
  chain: ChainSlug;
  routeId?: string;
  assetAddress?: string | "native";
  amount: string;
  targetAddress?: string;
  destinationChain?: ChainSlug;
  originChainId?: number;
  destinationChainId?: number;
  quoteTimestamp?: number;
  slippageBps?: number;
}

export interface BridgeJob {
  id: string;
  protocol?: "across";
  address: string;
  sourceChain: ChainSlug;
  destinationChain: ChainSlug;
  originChainId?: number;
  destinationChainId?: number;
  depositId?: string;
  assetAddress: string | "native";
  amount: string;
  status: BridgeJobStatus;
  txHash?: `0x${string}`;
  originTxHash?: `0x${string}`;
  quoteTimestamp?: number;
  expectedFillSeconds?: number;
  lastSyncedAt?: string;
  statusDetail?: string;
  createdAt: string;
  updatedAt: string;
  nextActionLabel?: string;
}

export interface ProtocolTokenSupport {
  chain: ChainSlug;
  address: string | "native";
  symbol: string;
  decimals?: number;
}

export interface SwapRouteConfig {
  routeId: string;
  label: string;
  chain: ChainSlug;
  dex: "uniswap_v3" | "aerodrome";
  enabled: boolean;
  routerAddress: string;
  tokenIn: string;
  tokenOut: string;
  feeTier?: number;
  supportsNativeIn: boolean;
  aerodromeStable?: boolean;
  aerodromeFactory?: string;
  inputTokenDecimals: number;
  outputTokenDecimals: number;
  defaultSlippageBps: number;
}

export interface ProtocolExecutionConfig {
  type: "send.native_erc20" | "swap.uniswap_v3" | "bridge.across";
  routeIds?: string[];
  bridgeApiBaseUrl?: string;
}

export interface ProtocolRegistryEntry {
  id: string;
  kind: "swap" | "bridge" | "send";
  profile: RuntimeProfile;
  label: string;
  chainSupport: ChainSlug[];
  supportedTokens: ProtocolTokenSupport[];
  execution: ProtocolExecutionConfig;
  swapRoutes?: SwapRouteConfig[];
  contractAddresses: Partial<Record<ChainSlug, string>>;
}

export interface ChainRuntimeConfig {
  slug: ChainSlug;
  chainId: number;
  label: string;
  wrappedNativeAddress: string;
}

export interface BridgeRuntimeConfig {
  protocol: "across";
  apiBaseUrl: string;
  integratorIdEnvKey: string;
  spokePoolAddresses: Partial<Record<ChainSlug, string>>;
  supportedAssets: ProtocolTokenSupport[];
}

export interface RuntimeProtocolConfig {
  profile: RuntimeProfile;
  chains: Record<ChainSlug, ChainRuntimeConfig>;
  swapRoutes: SwapRouteConfig[];
  bridge: BridgeRuntimeConfig;
  protocolRegistry: ProtocolRegistryEntry[];
}

export interface PartyConnectionState {
  connectionId: string;
  snapshot: PresenceSnapshot;
}

export interface SessionSlice {
  connectedAddress?: string;
  activeChain: ChainSlug;
  currentRoomId: WorldRoomId;
  walletConnected: boolean;
}

export interface WorldSlice {
  world: WorldConfig;
  selectedZoneId?: string;
}

export interface PresenceSlice {
  local?: PresenceSnapshot;
  remote: Record<string, PresenceSnapshot>;
  status: "disconnected" | "connecting" | "connected";
}

export interface PortfolioSlice {
  assets: PortfolioAsset[];
  loading: boolean;
  refreshedAt?: number;
}

export interface MinionSlice {
  minions: TokenMinion[];
  summary: MinionSummary;
}

export interface OverlaySlice {
  activeOverlay?:
    | "inventory"
    | "swap"
    | "bridge"
    | "send"
    | "jobs"
    | "chat"
    | "player"
    | "prediction";
  nearbyTarget?: string;
  swapSelectedAssetKey?: string;
  swapStep?: "select" | "details";
  sendSelectedAssetKey?: string;
  sendStep?: "select" | "details";
  bridgeSelectedAssetKey?: string;
  bridgeStep?: "select" | "details";
  predictionSelectedMarketIndex?: number;
}

export interface PendingTransactionsSlice {
  jobs: BridgeJob[];
  activeIntent?: TransactionIntent;
}

export interface PartyConnectionSlice {
  host: string;
  roomId: WorldRoomId;
}

export interface PredictionMarket {
  id: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  slug: string;
  updatedAt: number;
}
