import { useGLTF } from "@react-three/drei";
import {
  WORLD_CONFIG,
  type AvatarId,
  type PresenceSnapshot,
  type Vector3Like,
  type WorldRoomId,
} from "@chainatlas/shared";

import character1GlbUrl from "../../../../../assets-optimized/character-1.glb?url";
import character2GlbUrl from "../../../../../assets-optimized/character-2.glb?url";
import character3GlbUrl from "../../../../../assets-optimized/character-3.glb?url";
import character4GlbUrl from "../../../../../assets-optimized/character-4.glb?url";
import gateGlbUrl from "../../../../../assets-optimized/gate.glb?url";
import planeGlbUrl from "../../../../../assets-optimized/plane.glb?url";
import bridgeGlbUrl from "../../../../../assets-optimized/props-bridge.glb?url";
import building1GlbUrl from "../../../../../assets-optimized/props-building-1.glb?url";
import building2GlbUrl from "../../../../../assets-optimized/props-building-2.glb?url";
import building3GlbUrl from "../../../../../assets-optimized/props-building-3.glb?url";

export const ROOM_SPAWNS: Record<WorldRoomId, Vector3Like> = {
  "ethereum:main": { x: -58, y: 1.2, z: 0 },
  "base:main": { x: 58, y: 1.2, z: 0 },
};

export type ZoneConfig = (typeof WORLD_CONFIG.interactionZones)[number];
export type Vec3Tuple = [number, number, number];
export type CircleArea = { x: number; z: number; r: number };
export type RectArea = { x: number; z: number; hx: number; hz: number };
export type RotatedRectArea = RectArea & { rotationY?: number };
export type BuildingObstacle = {
  x?: number;
  z?: number;
  hx: number;
  hz: number;
  rotationY?: number;
};

export type BuildingNode = {
  id: string;
  label?: string;
  modelUrl: string;
  position: Vec3Tuple;
  rotationY?: number;
  facingDeg?: number;
  scale: number;
  obstacle: BuildingObstacle;
  interactionZoneId?: string;
  interactionZoneSize?: Pick<Vector3Like, "x" | "z">;
};

export const AVATAR_RADIUS = 0.9;
export const COLLISION_PUSH_BIAS = 0;
export const COLLISION_EPSILON = 0.04;
const BUILDING_COLLISION_MARGIN = 0.75;
const BUILDING_COLLISION_INSET = AVATAR_RADIUS + BUILDING_COLLISION_MARGIN;
export const MINION_SIZE_MULTIPLIER = 2;
export const AVATAR_GROUND_OFFSET = 0.02;
export const CAMERA_FOLLOW_DISTANCE = 16.5;
export const CAMERA_FOLLOW_HEIGHT = 11.2;
export const SWAP_SELECT_CAMERA_DISTANCE = 8.8;
export const SWAP_SELECT_CAMERA_HEIGHT = 6.4;
export const CAMERA_MIN_DISTANCE = 7.5;
export const CAMERA_MAX_DISTANCE = 28;
export const CAMERA_ZOOM_SENSITIVITY = 0.012;
export const CAMERA_ORBIT_SENSITIVITY = 0.0065;
export const AVATAR_MOVE_SPEED = 12;
export const LABEL_BUILDING_RANGE = 26;
export const LABEL_ISLAND_RANGE = 54;
export const LABEL_ZONE_RANGE = 22;
export const PRESENCE_PUBLISH_INTERVAL_MS = 75;
export const PRESENCE_MIN_DISTANCE_DELTA_SQ = 0.035 * 0.035;
export const PRESENCE_MIN_ROTATION_DELTA = 0.02;
export const SOCKET_MINION_LIMIT = 6;
export const SOCKET_VISIBLE_SYMBOL_LIMIT = 12;
export const REMOTE_MINION_RENDER_LIMIT = 3;
export const REMOTE_POSITION_LERP_SPEED = 12;
export const REMOTE_ROTATION_LERP_SPEED = 14;
export const REMOTE_HARD_SNAP_DISTANCE = 14;
export const REMOTE_MOVEMENT_EPSILON = 0.04;
export const REMOTE_MOVEMENT_IDLE_GRACE_MS = 650;
export const REMOTE_FLOATING_TEXT_RANGE = 20;
export const ACTION_FLOATING_TEXT_TTL_MS = 4_000;
export const GATE_SWITCH_TIMEOUT_MS = 12_000;

export const BRIDGE_CONFIG = {
  position: [0, -3, 12] as Vec3Tuple,
  rotationY: Math.PI / 2,
  scale: [78, 18, 48] as Vec3Tuple,
  walkway: {
    x: 0,
    z: 12,
    hx: 44,
    hz: 7,
  },
  roomSwitch: {
    xThresholdOffset: 24,
    zHalfSpan: 6,
  },
  interactionZones: {
    "bridge-gate-eth": {
      xOffset: -10,
      zOffset: 0,
      size: { x: 18, z: 10 },
    },
    "bridge-gate-base": {
      xOffset: 10,
      zOffset: 0,
      size: { x: 18, z: 10 },
    },
  },
} as const;

export const BRIDGE_GATE_CONFIG = {
  position: [0, 0.28, 12] as Vec3Tuple,
  rotationY: Math.PI / 2,
  scale: [10, 10, 10] as Vec3Tuple,
  blockHalfX: 0.9,
  blockHalfZ: 6.4,
  interactHalfX: 9,
  interactHalfZ: 7.5,
} as const;

const ISLAND_SCALE = 0.45;
const ISLAND_NODES: Array<{ label: string; position: Vec3Tuple }> = [
  { label: "Ethereum Island", position: [-58, -2.2, 0] },
  { label: "Base Island", position: [58, -2.2, 0] },
];

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function shortenAddress(value?: string) {
  if (!value) {
    return "Unknown";
  }
  if (!value.startsWith("0x") || value.length < 10) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function getBuildingRotationY(building: BuildingNode) {
  if (typeof building.facingDeg === "number") {
    return degreesToRadians(building.facingDeg);
  }
  return building.rotationY ?? 0;
}

const FUNCTIONAL_BUILDINGS: BuildingNode[] = [
  {
    id: "swap-eth",
    label: "Swap Hall",
    modelUrl: building3GlbUrl,
    position: [-50, 2, -10],
    facingDeg: 14.3,
    scale: 10,
    obstacle: { hx: 5.6, hz: 5.6 },
    interactionZoneId: "swap-building-ethereum",
    interactionZoneSize: { x: 14, z: 14 },
  },
  {
    id: "swap-base",
    label: "Swap Hall",
    modelUrl: building3GlbUrl,
    position: [52, 0.32, 20],
    facingDeg: -122,
    scale: 10,
    obstacle: { hx: 5.6, hz: 5.6 },
    interactionZoneId: "swap-building-base",
    interactionZoneSize: { x: 14, z: 14 },
  },
  {
    id: "send-eth",
    label: "Courier Post",
    modelUrl: building1GlbUrl,
    position: [-70, 0.35, 12],
    facingDeg: -262,
    scale: 12,
    obstacle: { hx: 5.2, hz: 5.2 },
    interactionZoneId: "send-ethereum",
    interactionZoneSize: { x: 12, z: 12 },
  },
  {
    id: "send-base",
    label: "Courier Post",
    modelUrl: building1GlbUrl,
    position: [66, 0.35, 12],
    facingDeg: -128,
    scale: 12,
    obstacle: { hx: 5.2, hz: 5.2 },
    interactionZoneId: "send-base",
    interactionZoneSize: { x: 12, z: 12 },
  },
];

const DECORATIVE_BUILDINGS: BuildingNode[] = [
  {
    id: "decor-eth-1",
    modelUrl: building1GlbUrl,
    position: [-40, 0.35, 16],
    facingDeg: -5.7,
    scale: 8.8,
    obstacle: { hx: 5, hz: 5 },
  },
  {
    id: "decor-eth-2",
    modelUrl: building2GlbUrl,
    position: [-72, 0.35, -18],
    facingDeg: 34.4,
    scale: 8.6,
    obstacle: { hx: 4.8, hz: 4.8 },
  },
  {
    id: "decor-base-1",
    modelUrl: building3GlbUrl,
    position: [40, 0.35, 16],
    facingDeg: 5.7,
    scale: 8.8,
    obstacle: { hx: 5, hz: 5 },
  },
  {
    id: "decor-base-2",
    modelUrl: building1GlbUrl,
    position: [72, 0.35, -18],
    facingDeg: -34.4,
    scale: 8.6,
    obstacle: { hx: 4.8, hz: 4.8 },
  },
];

// const ALL_BUILDINGS = [...FUNCTIONAL_BUILDINGS, ...DECORATIVE_BUILDINGS];
const ALL_BUILDINGS = [...FUNCTIONAL_BUILDINGS];
const BUILDINGS_BY_INTERACTION_ZONE_ID: Record<string, BuildingNode> =
  FUNCTIONAL_BUILDINGS.reduce<Record<string, BuildingNode>>(
    (zones, building) => {
      if (building.interactionZoneId) {
        zones[building.interactionZoneId] = building;
      }
      return zones;
    },
    {},
  );
export const SCENE_INTERACTION_ZONES: ZoneConfig[] = WORLD_CONFIG.interactionZones.map(
  (zone) => {
    const bridgeZoneOverride =
      BRIDGE_CONFIG.interactionZones[
        zone.id as keyof typeof BRIDGE_CONFIG.interactionZones
      ];
    if (bridgeZoneOverride) {
      return {
        ...zone,
        position: {
          ...zone.position,
          x: BRIDGE_CONFIG.position[0] + bridgeZoneOverride.xOffset,
          z: BRIDGE_CONFIG.position[2] + bridgeZoneOverride.zOffset,
        },
        size: {
          ...zone.size,
          x: bridgeZoneOverride.size.x,
          z: bridgeZoneOverride.size.z,
        },
      };
    }

    const linkedBuilding = BUILDINGS_BY_INTERACTION_ZONE_ID[zone.id];
    if (!linkedBuilding || !linkedBuilding.interactionZoneSize) {
      return zone;
    }

    return {
      ...zone,
      position: {
        ...zone.position,
        x: linkedBuilding.position[0],
        z: linkedBuilding.position[2],
      },
      size: {
        ...zone.size,
        x: linkedBuilding.interactionZoneSize.x,
        z: linkedBuilding.interactionZoneSize.z,
      },
    };
  },
);

export const WALKABLE_CIRCLES: CircleArea[] = [
  { x: -58, z: 0, r: 43 },
  { x: 58, z: 0, r: 43 },
];

export const WALKABLE_RECTS: RectArea[] = [
  {
    x: BRIDGE_CONFIG.walkway.x,
    z: BRIDGE_CONFIG.walkway.z,
    hx: BRIDGE_CONFIG.walkway.hx,
    hz: BRIDGE_CONFIG.walkway.hz,
  },
];

export const OBSTACLE_RECTS: RotatedRectArea[] = ALL_BUILDINGS.map((building) => ({
  x: building.obstacle.x ?? building.position[0],
  z: building.obstacle.z ?? building.position[2],
  // Building obstacles are authored at mesh footprint size. Inset by avatar
  // radius so the runtime expansion lands on the visible building edge.
  hx: Math.max(building.obstacle.hx - BUILDING_COLLISION_INSET, 0.25),
  hz: Math.max(building.obstacle.hz - BUILDING_COLLISION_INSET, 0.25),
  rotationY: building.obstacle.rotationY ?? getBuildingRotationY(building),
}));

export const OBSTACLE_CIRCLES: CircleArea[] = [];

export const CHARACTER_MODEL_BY_ID: Record<AvatarId, string> = {
  navigator: character1GlbUrl,
  warden: character2GlbUrl,
  sprinter: character3GlbUrl,
  mystic: character4GlbUrl,
};

[
  planeGlbUrl,
  bridgeGlbUrl,
  gateGlbUrl,
  building1GlbUrl,
  building2GlbUrl,
  building3GlbUrl,
  character1GlbUrl,
  character2GlbUrl,
  character3GlbUrl,
  character4GlbUrl,
].forEach((url) => {
  useGLTF.preload(url);
});

export const WORLD_ASSETS = {
  planeGlbUrl,
  bridgeGlbUrl,
  gateGlbUrl,
  building1GlbUrl,
  building2GlbUrl,
  building3GlbUrl,
  ISLAND_SCALE,
  ISLAND_NODES,
  FUNCTIONAL_BUILDINGS,
  DECORATIVE_BUILDINGS,
};

export function getInteractionFloatingLabel(
  status: PresenceSnapshot["interactionStatus"],
) {
  if (status === "swapping") {
    return "Swapping tokens";
  }
  if (status === "sending") {
    return "Sending tokens";
  }
  if (status === "bridging") {
    return "Bridging";
  }
  return undefined;
}
