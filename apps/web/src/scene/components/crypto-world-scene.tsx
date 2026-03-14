import { useAppStore } from "@/lib/store/app-store";
import {
  ensureWalletChain,
  isLikelyEmbeddedWallet,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import {
  WORLD_CONFIG,
  type AvatarId,
  type ChainSlug,
  type PresenceSnapshot,
  type TokenMinion,
  type Vector3Like,
  type WorldRoomId,
} from "@cryptoworld/shared";
import { Html, Sky, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimationAction,
  AnimationMixer,
  ConeGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import character1GlbUrl from "../../../../assets-optimized/character-1.glb?url";
import character2GlbUrl from "../../../../assets-optimized/character-2.glb?url";
import character3GlbUrl from "../../../../assets-optimized/character-3.glb?url";
import character4GlbUrl from "../../../../assets-optimized/character-4.glb?url";
import planeGlbUrl from "../../../../assets-optimized/plane.glb?url";
import bridgeGlbUrl from "../../../../assets-optimized/props-bridge.glb?url";
import gateGlbUrl from "../../../../assets-optimized/gate.glb?url";
import building1GlbUrl from "../../../../assets-optimized/props-building-1.glb?url";
import building2GlbUrl from "../../../../assets-optimized/props-building-2.glb?url";
import building3GlbUrl from "../../../../assets-optimized/props-building-3.glb?url";

const ROOM_SPAWNS: Record<WorldRoomId, Vector3Like> = {
  "ethereum:main": { x: -58, y: 1.2, z: 0 },
  "base:main": { x: 58, y: 1.2, z: 0 },
};

type ZoneConfig = (typeof WORLD_CONFIG.interactionZones)[number];
type Vec3Tuple = [number, number, number];
type CircleArea = { x: number; z: number; r: number };
type RectArea = { x: number; z: number; hx: number; hz: number };
type RotatedRectArea = RectArea & { rotationY?: number };
type BuildingObstacle = {
  x?: number;
  z?: number;
  hx: number;
  hz: number;
  rotationY?: number;
};

type BuildingNode = {
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

const AVATAR_RADIUS = 0.9;
const COLLISION_PUSH_BIAS = 0;
const COLLISION_EPSILON = 0.04;
const BUILDING_COLLISION_MARGIN = 0.75;
const BUILDING_COLLISION_INSET = AVATAR_RADIUS + BUILDING_COLLISION_MARGIN;
const MINION_SIZE_MULTIPLIER = 2;
const AVATAR_GROUND_OFFSET = 0.02;
const CAMERA_FOLLOW_DISTANCE = 16.5;
const CAMERA_FOLLOW_HEIGHT = 11.2;
const SWAP_SELECT_CAMERA_DISTANCE = 8.8;
const SWAP_SELECT_CAMERA_HEIGHT = 6.4;
const CAMERA_MIN_DISTANCE = 7.5;
const CAMERA_MAX_DISTANCE = 28;
const CAMERA_ZOOM_SENSITIVITY = 0.012;
const CAMERA_ORBIT_SENSITIVITY = 0.0065;
const AVATAR_MOVE_SPEED = 12;
const LABEL_BUILDING_RANGE = 26;
const LABEL_ISLAND_RANGE = 54;
const LABEL_ZONE_RANGE = 22;
const PRESENCE_PUBLISH_INTERVAL_MS = 100;
const PRESENCE_MIN_DISTANCE_DELTA_SQ = 0.05 * 0.05;
const PRESENCE_MIN_ROTATION_DELTA = 0.025;
const GATE_SWITCH_TIMEOUT_MS = 12_000;
const WORLD_UP = new Vector3(0, 1, 0);
const BRIDGE_CONFIG = {
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

const BRIDGE_GATE_CONFIG = {
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

function getBuildingRotationY(building: BuildingNode) {
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
const SCENE_INTERACTION_ZONES: ZoneConfig[] = WORLD_CONFIG.interactionZones.map(
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

const WALKABLE_CIRCLES: CircleArea[] = [
  { x: -58, z: 0, r: 43 },
  { x: 58, z: 0, r: 43 },
];

const WALKABLE_RECTS: RectArea[] = [
  {
    x: BRIDGE_CONFIG.walkway.x,
    z: BRIDGE_CONFIG.walkway.z,
    hx: BRIDGE_CONFIG.walkway.hx,
    hz: BRIDGE_CONFIG.walkway.hz,
  },
];

const OBSTACLE_RECTS: RotatedRectArea[] = ALL_BUILDINGS.map((building) => ({
  x: building.obstacle.x ?? building.position[0],
  z: building.obstacle.z ?? building.position[2],
  // Building obstacles are authored at mesh footprint size. Inset by avatar
  // radius so the runtime expansion lands on the visible building edge.
  hx: Math.max(building.obstacle.hx - BUILDING_COLLISION_INSET, 0.25),
  hz: Math.max(building.obstacle.hz - BUILDING_COLLISION_INSET, 0.25),
  rotationY: building.obstacle.rotationY ?? getBuildingRotationY(building),
}));

const OBSTACLE_CIRCLES: CircleArea[] = [];

const CHARACTER_MODEL_BY_ID: Record<AvatarId, string> = {
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

function isInsideCircle(x: number, z: number, area: CircleArea) {
  const dx = x - area.x;
  const dz = z - area.z;
  return dx * dx + dz * dz <= area.r * area.r;
}

function isInsideRect(x: number, z: number, area: RectArea) {
  return Math.abs(x - area.x) <= area.hx && Math.abs(z - area.z) <= area.hz;
}

function isWalkable(x: number, z: number) {
  return (
    WALKABLE_CIRCLES.some((area) => isInsideCircle(x, z, area)) ||
    WALKABLE_RECTS.some((area) => isInsideRect(x, z, area))
  );
}

function pushOutOfRect(x: number, z: number, rect: RotatedRectArea) {
  const rotation = rect.rotationY ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const relX = x - rect.x;
  const relZ = z - rect.z;
  const localX = relX * cos + relZ * sin;
  const localZ = -relX * sin + relZ * cos;
  const expandedHx = rect.hx + AVATAR_RADIUS + COLLISION_PUSH_BIAS;
  const expandedHz = rect.hz + AVATAR_RADIUS + COLLISION_PUSH_BIAS;

  if (Math.abs(localX) > expandedHx || Math.abs(localZ) > expandedHz) {
    return { x, z };
  }

  const penX = expandedHx - Math.abs(localX);
  const penZ = expandedHz - Math.abs(localZ);
  if (penX <= COLLISION_EPSILON && penZ <= COLLISION_EPSILON) {
    return { x, z };
  }

  let nextLocalX = localX;
  let nextLocalZ = localZ;
  if (penX < penZ) {
    nextLocalX =
      localX >= 0
        ? expandedHx + COLLISION_EPSILON
        : -expandedHx - COLLISION_EPSILON;
  } else {
    nextLocalZ =
      localZ >= 0
        ? expandedHz + COLLISION_EPSILON
        : -expandedHz - COLLISION_EPSILON;
  }

  const worldOffsetX = nextLocalX * cos - nextLocalZ * sin;
  const worldOffsetZ = nextLocalX * sin + nextLocalZ * cos;
  return { x: rect.x + worldOffsetX, z: rect.z + worldOffsetZ };
}

function pushOutOfObstacles(x: number, z: number) {
  let nextX = x;
  let nextZ = z;

  for (let pass = 0; pass < 2; pass += 1) {
    for (const obstacle of OBSTACLE_RECTS) {
      const adjusted = pushOutOfRect(nextX, nextZ, obstacle);
      nextX = adjusted.x;
      nextZ = adjusted.z;
    }

    for (const obstacle of OBSTACLE_CIRCLES) {
      const dx = nextX - obstacle.x;
      const dz = nextZ - obstacle.z;
      const minDistance = obstacle.r + AVATAR_RADIUS + COLLISION_PUSH_BIAS;
      const distanceSquared = dx * dx + dz * dz;
      const safeDistance = Math.max(minDistance - COLLISION_EPSILON, 0.0001);

      if (distanceSquared >= safeDistance * safeDistance) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      if (distance <= COLLISION_EPSILON) {
        nextX = obstacle.x + minDistance + COLLISION_EPSILON;
        continue;
      }
      const pushScale = (minDistance + COLLISION_EPSILON) / distance;
      nextX = obstacle.x + dx * pushScale;
      nextZ = obstacle.z + dz * pushScale;
    }
  }

  return { x: nextX, z: nextZ };
}

function resolveMovement(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
) {
  const candidate = pushOutOfObstacles(targetX, targetZ);
  if (isWalkable(candidate.x, candidate.z)) {
    return candidate;
  }

  const xOnly = pushOutOfObstacles(targetX, currentZ);
  if (isWalkable(xOnly.x, xOnly.z)) {
    return xOnly;
  }

  const zOnly = pushOutOfObstacles(currentX, targetZ);
  if (isWalkable(zOnly.x, zOnly.z)) {
    return zOnly;
  }

  for (const factor of [0.85, 0.65, 0.45, 0.25]) {
    const blended = pushOutOfObstacles(
      currentX + (candidate.x - currentX) * factor,
      currentZ + (candidate.z - currentZ) * factor,
    );

    if (isWalkable(blended.x, blended.z)) {
      return blended;
    }
  }

  return { x: currentX, z: currentZ };
}

function shortestAngleDelta(current: number, target: number) {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) {
    delta -= twoPi;
  }
  if (delta < -Math.PI) {
    delta += twoPi;
  }
  return delta;
}

function getOverlayForZone(zone?: ZoneConfig) {
  if (!zone) {
    return undefined;
  }
  if (zone.kind === "swap") {
    return "swap" as const;
  }
  if (zone.kind === "bridge") {
    return "bridge" as const;
  }
  if (zone.kind === "send") {
    return "send" as const;
  }
  return undefined;
}

function FloatingLabel({
  distancePosition,
  label,
  maxDistance,
  position,
  referencePosition,
  visible = true,
}: {
  distancePosition?: Vec3Tuple;
  label: string;
  maxDistance?: number;
  position: Vec3Tuple;
  referencePosition?: Vector3Like;
  visible?: boolean;
}) {
  if (!visible) {
    return null;
  }

  if (referencePosition && maxDistance !== undefined) {
    const anchor = distancePosition ?? position;
    const distance = Math.hypot(
      referencePosition.x - anchor[0],
      referencePosition.z - anchor[2],
    );
    if (distance > maxDistance) {
      return null;
    }
  }

  return (
    <Html center distanceFactor={20} occlude position={position}>
      <div className="pointer-events-none border-l-2 border-white/40 bg-black/20 px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-white/90 shadow-[0_1px_8px_rgba(0,0,0,0.45)] whitespace-nowrap">
        {label}
      </div>
    </Html>
  );
}

function ModelInstance({
  url,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  onObjectChange,
}: {
  url: string;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: number | Vec3Tuple;
  onObjectChange?(object?: Object3D): void;
}) {
  const gltf = useGLTF(url);
  const clone = useMemo(
    () => cloneSkinned(gltf.scene) as Object3D,
    [gltf.scene],
  );

  useEffect(() => {
    clone.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }, [clone]);

  useEffect(() => {
    onObjectChange?.(clone);
    return () => onObjectChange?.(undefined);
  }, [clone, onObjectChange]);

  return (
    <primitive
      object={clone}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
}

function GatePortal({ open }: { open: boolean }) {
  const gltf = useGLTF(gateGlbUrl);
  const clone = useMemo(
    () => cloneSkinned(gltf.scene) as Object3D,
    [gltf.scene],
  );
  const mixerRef = useRef<AnimationMixer | null>(null);
  const activeActionsRef = useRef<AnimationAction[]>([]);
  const openActionsRef = useRef<AnimationAction[]>([]);
  const closeActionsRef = useRef<AnimationAction[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    clone.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const mixer = new AnimationMixer(clone);
    mixerRef.current = mixer;

    const selectClips = (
      exactNames: string[],
      fallbackMatcher: (name: string) => boolean,
    ) => {
      const exactNameSet = new Set(exactNames.map((name) => name.toLowerCase()));
      const exactClips = gltf.animations.filter((clip) =>
        exactNameSet.has(clip.name.trim().toLowerCase()),
      );
      if (exactClips.length > 0) {
        return exactClips;
      }

      return gltf.animations.filter((clip) =>
        fallbackMatcher(clip.name.trim().toLowerCase()),
      );
    };

    const buildActions = (clips: typeof gltf.animations) => {
      if (clips.length === 0) {
        return [];
      }

      return clips.map((clip) => {
        const action = mixer.clipAction(clip, clone);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        return action;
      });
    };

    const playActions = (actions: AnimationAction[]) => {
      for (const action of actions) {
        action.reset();
        action.play();
      }
    };

    const openActions = buildActions(
      selectClips(
        ["gate_open", "gate_open_l", "gate_open_r"],
        (name) => name.includes("open") && name.includes("gate"),
      ),
    );
    const closeActions = buildActions(
      selectClips(
        ["gate_close", "gate_close_l", "gate_close_r"],
        (name) => name.includes("close") && name.includes("gate"),
      ),
    );
    const idleClosedActions = buildActions(
      selectClips(
        ["idle_closed", "idle_closed_l", "idle_closed_r"],
        (name) => name.includes("idle") && name.includes("closed"),
      ),
    );

    openActionsRef.current = openActions;
    closeActionsRef.current = closeActions;

    if (idleClosedActions.length > 0) {
      playActions(idleClosedActions);
      activeActionsRef.current = idleClosedActions;
    } else if (closeActions.length > 0) {
      playActions(closeActions);
      activeActionsRef.current = closeActions;
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clone);
      mixerRef.current = null;
      activeActionsRef.current = [];
      openActionsRef.current = [];
      closeActionsRef.current = [];
    };
  }, [clone, gltf.animations]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    const nextActions = open ? openActionsRef.current : closeActionsRef.current;
    if (nextActions.length === 0) {
      return;
    }

    for (const action of activeActionsRef.current) {
      if (!nextActions.includes(action)) {
        action.fadeOut(0.12);
      }
    }
    for (const action of nextActions) {
      action.reset();
      action.fadeIn(0.12);
      action.play();
    }
    activeActionsRef.current = nextActions;
  }, [open]);

  useFrame((_, delta) => {
    if (!mixerRef.current) {
      return;
    }
    mixerRef.current.update(delta);
  });

  return (
    <primitive
      object={clone}
      position={BRIDGE_GATE_CONFIG.position}
      rotation={[0, BRIDGE_GATE_CONFIG.rotationY, 0]}
      scale={BRIDGE_GATE_CONFIG.scale}
    />
  );
}

function WaterPlane() {
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<MeshStandardMaterial>(null);

  useFrame(({ camera }, delta) => {
    if (meshRef.current) {
      // Keep the water centered on camera so backdrop edges never enter view.
      meshRef.current.position.x = camera.position.x;
      meshRef.current.position.z = camera.position.z;
    }

    if (!materialRef.current) {
      return;
    }

    materialRef.current.emissiveIntensity =
      0.08 + Math.sin(performance.now() * 0.001 + delta) * 0.01;
  });

  return (
    <mesh
      ref={meshRef}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -3.1, 0]}
    >
      <planeGeometry args={[1200, 1200]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#123a52"
        emissive="#0f2c3e"
        emissiveIntensity={0.08}
      />
    </mesh>
  );
}

function ZonePad({
  hideLabel = false,
  labelsVisible,
  referencePosition,
  zone,
}: {
  hideLabel?: boolean;
  zone: ZoneConfig;
  labelsVisible: boolean;
  referencePosition?: Vector3Like;
}) {
  return (
    <group position={[zone.position.x, 0.5, zone.position.z]}>
      <FloatingLabel
        distancePosition={[zone.position.x, 1.4, zone.position.z]}
        label={zone.label}
        maxDistance={LABEL_ZONE_RANGE}
        position={[0, 1.4, 0]}
        referencePosition={referencePosition}
        visible={labelsVisible && !hideLabel}
      />
    </group>
  );
}

const ZonePads = memo(function ZonePads({
  hiddenZoneId,
  labelsVisible,
  referencePosition,
  roomId,
}: {
  hiddenZoneId?: string;
  roomId: WorldRoomId;
  labelsVisible: boolean;
  referencePosition?: Vector3Like;
}) {
  const zones = useMemo(
    () => SCENE_INTERACTION_ZONES.filter((zone) => zone.roomId === roomId),
    [roomId],
  );

  return (
    <group>
      {zones.map((zone) => (
        <ZonePad
          hideLabel={zone.id === hiddenZoneId}
          key={zone.id}
          labelsVisible={labelsVisible}
          referencePosition={referencePosition}
          zone={zone}
        />
      ))}
    </group>
  );
});

const WorldProps = memo(function WorldProps({
  bridgeGateOpen,
  currentRoomId,
  labelsVisible,
  onGroundSurfaceChange,
  referencePosition,
}: {
  bridgeGateOpen: boolean;
  currentRoomId: WorldRoomId;
  labelsVisible: boolean;
  onGroundSurfaceChange(surfaceId: string, object?: Object3D): void;
  referencePosition?: Vector3Like;
}) {
  return (
    <group>
      {ISLAND_NODES.map((island) => (
        <group key={island.label}>
          <ModelInstance
            onObjectChange={(object) =>
              onGroundSurfaceChange(`island:${island.label}`, object)
            }
            position={island.position}
            rotation={[0, 0, 0]}
            scale={[ISLAND_SCALE, ISLAND_SCALE, ISLAND_SCALE]}
            url={planeGlbUrl}
          />
          <FloatingLabel
            label={island.label}
            maxDistance={LABEL_ISLAND_RANGE}
            position={[
              island.position[0],
              island.position[1] + 9.5,
              island.position[2],
            ]}
            referencePosition={referencePosition}
            visible={labelsVisible}
          />
        </group>
      ))}

      <ModelInstance
        onObjectChange={(object) =>
          onGroundSurfaceChange("bridge:main", object)
        }
        position={BRIDGE_CONFIG.position}
        rotation={[0, BRIDGE_CONFIG.rotationY, 0]}
        scale={BRIDGE_CONFIG.scale}
        url={bridgeGlbUrl}
      />
      <GatePortal open={bridgeGateOpen} />

      {FUNCTIONAL_BUILDINGS.map((building) => (
        <group key={building.id}>
          <ModelInstance
            position={building.position}
            rotation={[0, getBuildingRotationY(building), 0]}
            scale={building.scale}
            url={building.modelUrl}
          />
          {building.label &&
          !SCENE_INTERACTION_ZONES.some(
            (zone) =>
              zone.roomId === currentRoomId &&
              Math.hypot(
                zone.position.x - building.position[0],
                zone.position.z - building.position[2],
              ) < 2,
          ) ? (
            <FloatingLabel
              label={building.label}
              maxDistance={LABEL_BUILDING_RANGE}
              position={[
                building.position[0],
                building.position[1] + 3.1,
                building.position[2],
              ]}
              referencePosition={referencePosition}
              visible={labelsVisible}
            />
          ) : null}
        </group>
      ))}

      {/* {DECORATIVE_BUILDINGS.map((building) => (
        <ModelInstance
          key={building.id}
          position={building.position}
          rotation={[0, building.rotationY, 0]}
          scale={building.scale}
          url={building.modelUrl}
        />
      ))} */}
    </group>
  );
});

function formatMinionBalance(balance: string) {
  const value = Number(balance);
  if (!Number.isFinite(value)) {
    return balance;
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function TokenMinions({
  labelsVisible = true,
  minions,
  onSelect,
  position,
  selectionMode = false,
  selectedAssetKey,
}: {
  labelsVisible?: boolean;
  minions: TokenMinion[];
  onSelect?(minion: TokenMinion): void;
  position: Vector3Like;
  selectionMode?: boolean;
  selectedAssetKey?: string;
}) {
  const geometryPool = useMemo(() => {
    const body = new SphereGeometry(0.22, 18, 18);
    const eye = new SphereGeometry(0.026, 10, 10);
    const horn = new ConeGeometry(0.07, 0.12, 5);
    const selectorRing = new TorusGeometry(0.36, 0.018, 10, 44);
    return {
      body,
      eye,
      horn,
      selectorRing,
      dispose() {
        body.dispose();
        eye.dispose();
        horn.dispose();
        selectorRing.dispose();
      },
    };
  }, []);

  useEffect(() => {
    return () => geometryPool.dispose();
  }, [geometryPool]);

  if (minions.length === 0) {
    return null;
  }

  return (
    <group position={[position.x, position.y, position.z]}>
      {minions.map((minion, index) => (
        <MinionOrb
          key={minion.id}
          geometryPool={geometryPool}
          index={index}
          labelsVisible={labelsVisible}
          minion={minion}
          onSelect={onSelect}
          selectionMode={selectionMode}
          selected={selectedAssetKey === minion.assetKey}
        />
      ))}
    </group>
  );
}

function MinionOrb({
  geometryPool,
  index,
  labelsVisible,
  minion,
  onSelect,
  selectionMode,
  selected,
}: {
  geometryPool: {
    body: SphereGeometry;
    eye: SphereGeometry;
    horn: ConeGeometry;
    selectorRing: TorusGeometry;
  };
  minion: TokenMinion;
  index: number;
  labelsVisible: boolean;
  onSelect?(minion: TokenMinion): void;
  selectionMode: boolean;
  selected: boolean;
}) {
  const ref = useRef<Group>(null);
  const selectorRef = useRef<Mesh>(null);
  const spawnProgressRef = useRef(0);
  const [isHovered, setIsHovered] = useState(false);
  const scale = minion.scale * MINION_SIZE_MULTIPLIER;

  useFrame(({ clock }, delta) => {
    if (!ref.current) {
      return;
    }

    const spawnProgress = Math.min(1, spawnProgressRef.current + delta * 4.6);
    spawnProgressRef.current = spawnProgress;
    const spawnEase = 1 - (1 - spawnProgress) ** 3;
    const spawnLift = (1 - spawnEase) * 0.48;
    const spawnScale = 0.52 + spawnEase * 0.48;
    const selectedScale = selected ? 1.1 : 1;
    const t = clock.getElapsedTime() + minion.bobOffset;
    const row = Math.floor(index / 3);
    const col = index % 3;
    const targetX = (col - 1) * 0.95;
    const targetZ = -1.5 - row * 0.9;
    const targetY = 1.55 + Math.sin(t * 2 + index * 0.35) * 0.18 + spawnLift;

    ref.current.position.x += (targetX - ref.current.position.x) * 0.14;
    ref.current.position.z += (targetZ - ref.current.position.z) * 0.14;
    ref.current.position.y += (targetY - ref.current.position.y) * 0.22;
    ref.current.scale.setScalar(scale * spawnScale * selectedScale);
    ref.current.rotation.z = Math.sin(t * 1.7 + index) * 0.09;

    if (selectorRef.current) {
      selectorRef.current.rotation.z += delta * 1.8;
      const pulse = 0.96 + Math.sin(t * 4.2 + index) * 0.06;
      selectorRef.current.scale.setScalar(selected ? pulse : 1);
    }
  });

  const usdText =
    minion.usdValue > 0
      ? `$${minion.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : undefined;

  const showHoverLabel = !selectionMode && isHovered && labelsVisible;

  return (
    <group ref={ref}>
      <mesh
        castShadow
        geometry={geometryPool.body}
        onPointerOut={() => setIsHovered(false)}
        onPointerOver={(event) => {
          if (!labelsVisible) {
            return;
          }
          event.stopPropagation();
          setIsHovered(true);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(minion);
        }}
      >
        <meshStandardMaterial
          color={`hsl(${minion.hue}, 66%, ${minion.actionable ? 66 : 48}%)`}
          emissive={`hsl(${minion.hue}, 58%, 34%)`}
          emissiveIntensity={selected ? 0.34 : 0.2}
        />
      </mesh>
      <mesh
        castShadow
        geometry={geometryPool.eye}
        position={[-0.08, 0.02, 0.19]}
      >
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh
        castShadow
        geometry={geometryPool.eye}
        position={[0.08, 0.02, 0.19]}
      >
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh
        castShadow
        geometry={geometryPool.horn}
        position={[0, 0.17, -0.06]}
        rotation={[0, Math.PI / 4, 0]}
      >
        <meshStandardMaterial
          color={`hsl(${(minion.hue + 24) % 360}, 76%, 72%)`}
        />
      </mesh>
      {selectionMode ? (
        <mesh
          ref={selectorRef}
          geometry={geometryPool.selectorRing}
          position={[0, -0.18, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <meshStandardMaterial
            color={selected ? "#9efad6" : "#7dd3fc"}
            emissive={selected ? "#34d399" : "#0ea5e9"}
            emissiveIntensity={selected ? 0.75 : 0.26}
            transparent
            opacity={selected ? 0.95 : 0.38}
          />
        </mesh>
      ) : null}
      {selectionMode && selected ? (
        <Html position={[0, 0.78, 0]} center distanceFactor={16}>
          <div className="pointer-events-none rounded-xl border border-emerald-200/40 bg-[#071a20]/88 px-2.5 py-1.5 text-cyan-50 shadow-[0_6px_20px_rgba(0,0,0,0.45)]">
            <p className="text-[9px] font-semibold tracking-[0.06em] text-emerald-100/90 uppercase">
              target locked
            </p>
            <p className="text-[14px] font-semibold leading-tight">{minion.symbol}</p>
            <p className="text-[11px] tabular-nums text-cyan-100/90">
              {formatMinionBalance(minion.balance)}
            </p>
          </div>
        </Html>
      ) : null}
      {showHoverLabel ? (
        <Html position={[0, 0.5, 0]} center distanceFactor={12}>
          <div className="min-w-[180px] rounded-2xl border border-cyan-100/25 bg-[#0d1720]/90 px-3 py-2 text-[11px] text-cyan-50 shadow-xl">
            <p className="font-semibold">
              {minion.symbol} | {minion.chain}
            </p>
            <p className="text-cyan-100/85">{minion.name}</p>
            <p className="mt-1 font-medium tabular-nums">
              {formatMinionBalance(minion.balance)} {minion.symbol}
            </p>
            {usdText ? (
              <p className="text-cyan-100/75 tabular-nums">{usdText}</p>
            ) : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function AvatarNameTag({
  label,
  visible = true,
}: {
  label: string;
  visible?: boolean;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Html position={[0, 2.6, 0]} center>
      <div className="pointer-events-none border-l-2 border-white/40 bg-black/25 px-2 py-0.5 text-xs font-medium text-white/90 shadow-[0_1px_8px_rgba(0,0,0,0.45)]">
        {label}
      </div>
    </Html>
  );
}

function resolveWalkClipName(names: string[]) {
  return names.find((name) => /walk/i.test(name)) ?? names[0];
}

function hasBlockedGroundAncestor(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    const name = current.name.toLowerCase();
    if (name.includes("tree") || name.includes("water")) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function AvatarBody({
  avatarId,
  isMoving,
}: {
  avatarId: AvatarId;
  isMoving: boolean;
}) {
  const url = CHARACTER_MODEL_BY_ID[avatarId];
  const gltf = useGLTF(url);
  const clone = useMemo(
    () => cloneSkinned(gltf.scene) as Object3D,
    [gltf.scene],
  );
  const walkActionRef = useRef<AnimationAction | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const walkClipName = useMemo(
    () => resolveWalkClipName(gltf.animations.map((clip) => clip.name)),
    [gltf.animations],
  );
  const previousMovingRef = useRef(false);

  useEffect(() => {
    clone.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    const mixer = new AnimationMixer(clone);
    mixerRef.current = mixer;
    const walkClip =
      gltf.animations.find((clip) => clip.name === walkClipName) ??
      gltf.animations[0];
    if (walkClip) {
      walkActionRef.current = mixer.clipAction(walkClip, clone);
    }
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clone);
      walkActionRef.current = null;
      mixerRef.current = null;
    };
  }, [clone, gltf.animations, walkClipName]);

  useEffect(() => {
    const walkAction = walkActionRef.current;
    if (!walkAction) {
      return;
    }

    if (isMoving && !previousMovingRef.current) {
      walkAction.enabled = true;
      walkAction.reset();
      walkAction.fadeIn(0.12);
      walkAction.timeScale = 1;
      walkAction.play();
    }

    if (!isMoving && previousMovingRef.current) {
      walkAction.fadeOut(0.1);
      walkAction.stop();
      walkAction.enabled = false;
    }

    previousMovingRef.current = isMoving;
  }, [isMoving]);

  useFrame((_, delta) => {
    if (!mixerRef.current) {
      return;
    }
    mixerRef.current.update(delta);
  });

  return (
    <group>
      <primitive object={clone} position={[0, 0, 0]} scale={2} />
    </group>
  );
}

function RemoteAvatar({
  labelsVisible,
  snapshot,
}: {
  snapshot: PresenceSnapshot;
  labelsVisible: boolean;
}) {
  const previousPositionRef = useRef<
    { x: number; z: number; updatedAt: number } | undefined
  >(undefined);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    const previous = previousPositionRef.current;
    if (!previous) {
      previousPositionRef.current = {
        x: snapshot.position.x,
        z: snapshot.position.z,
        updatedAt: snapshot.updatedAt,
      };
      return;
    }

    const delta = Math.hypot(
      snapshot.position.x - previous.x,
      snapshot.position.z - previous.z,
    );
    const isRecentUpdate = snapshot.updatedAt - previous.updatedAt < 450;
    setIsMoving(delta > 0.01 && isRecentUpdate);

    previousPositionRef.current = {
      x: snapshot.position.x,
      z: snapshot.position.z,
      updatedAt: snapshot.updatedAt,
    };
  }, [snapshot.position.x, snapshot.position.z, snapshot.updatedAt]);

  return (
    <group
      position={[snapshot.position.x, snapshot.position.y, snapshot.position.z]}
      rotation={[snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z]}
    >
      <AvatarBody avatarId={snapshot.avatarId} isMoving={isMoving} />
      <TokenMinions
        labelsVisible={labelsVisible}
        minions={snapshot.minions ?? []}
        position={{ x: 0, y: 0, z: 0 }}
      />
      <AvatarNameTag label={snapshot.displayName} visible={labelsVisible} />
    </group>
  );
}

const Avatar = memo(function Avatar({
  avatarId,
  bridgeGateOpen,
  displayName,
  groundSurfaces,
  labelsVisible,
  onBridgeGateOpenChange,
  onZoneChange,
  onPositionChange,
}: {
  avatarId: AvatarId;
  bridgeGateOpen: boolean;
  displayName: string;
  groundSurfaces: Object3D[];
  labelsVisible: boolean;
  onBridgeGateOpenChange(open: boolean): void;
  onZoneChange?(zoneId?: string): void;
  onPositionChange(position: Vector3Like, rotationY: number): void;
}) {
  const { wallet } = usePrivyWallet();
  const setOverlay = useAppStore((state) => state.setOverlay);
  const setSwapSelection = useAppStore((state) => state.setSwapSelection);
  const setSwapStep = useAppStore((state) => state.setSwapStep);
  const setSendSelection = useAppStore((state) => state.setSendSelection);
  const setSendStep = useAppStore((state) => state.setSendStep);
  const setRoom = useAppStore((state) => state.setRoom);
  const activeOverlay = useAppStore((state) => state.overlays.activeOverlay);
  const swapStep = useAppStore((state) => state.overlays.swapStep);
  const sendStep = useAppStore((state) => state.overlays.sendStep);
  const selectedSwapAssetKey = useAppStore(
    (state) => state.overlays.swapSelectedAssetKey,
  );
  const selectedSendAssetKey = useAppStore(
    (state) => state.overlays.sendSelectedAssetKey,
  );
  const activeChain = useAppStore((state) => state.session.activeChain);
  const minions = useAppStore((state) => state.minions.list);
  const currentRoomId = useAppStore((state) => state.session.currentRoomId);
  const avatarRef = useRef<Group>(null);
  const cameraAnchorRef = useRef(new Vector3());
  const lookTargetRef = useRef(new Vector3());
  const lookAnchorRef = useRef(new Vector3());
  const didInitCameraRef = useRef(false);
  const hasSpawnedRef = useRef(false);
  const isMovingRef = useRef(false);
  const cameraPresentationDistanceRef = useRef(CAMERA_FOLLOW_DISTANCE);
  const cameraPresentationHeightRef = useRef(CAMERA_FOLLOW_HEIGHT);
  const cameraForwardRef = useRef(new Vector3());
  const cameraRightRef = useRef(new Vector3());
  const raycasterRef = useRef(new Raycaster());
  const rayOriginRef = useRef(new Vector3());
  const rayDirectionRef = useRef(new Vector3(0, -1, 0));
  const nearBridgeGateRef = useRef(false);
  const keys = useRef<Record<string, boolean>>({});
  const cameraOrbitYawRef = useRef(0);
  const cameraDistanceRef = useRef(CAMERA_FOLLOW_DISTANCE);
  const pointerDragRef = useRef<{
    pointerId: number;
    lastX: number;
    isDragging: boolean;
  } | null>(null);
  const gl = useThree((state) => state.gl);
  const [isMoving, setIsMoving] = useState(false);
  const [isNearBridgeGate, setIsNearBridgeGate] = useState(false);
  const [gateSwitching, setGateSwitching] = useState(false);
  const [gateSwitchError, setGateSwitchError] = useState<string>();
  const [targetPortalChain, setTargetPortalChain] = useState<ChainSlug>(
    currentRoomId === "ethereum:main" ? "base" : "ethereum",
  );
  const [currentZoneId, setCurrentZoneId] = useState<string>();
  const currentZone = useMemo(
    () => SCENE_INTERACTION_ZONES.find((zone) => zone.id === currentZoneId),
    [currentZoneId],
  );
  const currentZoneOverlay = useMemo(
    () => getOverlayForZone(currentZone),
    [currentZone],
  );
  const currentZoneOverlayRef = useRef<typeof currentZoneOverlay>(undefined);
  const swapSelectionMode = activeOverlay === "swap" && swapStep !== "details";
  const sendSelectionMode = activeOverlay === "send" && sendStep !== "details";
  const selectionMode = swapSelectionMode || sendSelectionMode;
  const targetPortalChainLabel =
    targetPortalChain === "ethereum" ? "Ethereum" : "Base";
  const selectableMinions = useMemo(
    () => minions.filter((minion) => minion.chain === activeChain),
    [activeChain, minions],
  );
  const handleMinionSelect = useCallback(
    (minion: TokenMinion) => {
      const zoneOverlay = currentZoneOverlayRef.current;
      const sendContext = sendSelectionMode || zoneOverlay === "send";
      const swapContext = swapSelectionMode || zoneOverlay === "swap";
      if ((!swapContext && !sendContext) || minion.chain !== activeChain) {
        return;
      }

      if (sendContext) {
        setSendSelection(minion.assetKey);
        if (activeOverlay !== "send") {
          setOverlay("send");
          setSendStep("select");
        }
        return;
      }

      setSwapSelection(minion.assetKey);
      if (activeOverlay !== "swap") {
        setOverlay("swap");
        setSwapStep("select");
      }
    },
    [
      activeChain,
      activeOverlay,
      selectionMode,
      sendSelectionMode,
      setOverlay,
      setSendSelection,
      setSendStep,
      setSwapSelection,
      setSwapStep,
      swapSelectionMode,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current[event.key.toLowerCase()] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    currentZoneOverlayRef.current = currentZoneOverlay;
  }, [currentZoneOverlay]);

  const requestBridgeGateUnlock = useCallback(async () => {
    if (bridgeGateOpen || gateSwitching) {
      return;
    }
    if (!wallet) {
      setGateSwitchError("Connect a wallet before unlocking the bridge gate.");
      return;
    }
    if (isLikelyEmbeddedWallet(wallet)) {
      setGateSwitchError(
        "External wallet required for portal chain switch. Reconnect with MetaMask/Phantom in wallet settings.",
      );
      return;
    }

    setOverlay(undefined);
    setGateSwitchError(undefined);
    setGateSwitching(true);
    try {
      await Promise.race([
        ensureWalletChain(wallet, targetPortalChain),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                "Wallet switch request timed out. Open wallet and confirm network switch, then retry.",
              ),
            );
          }, GATE_SWITCH_TIMEOUT_MS);
        }),
      ]);
      onBridgeGateOpenChange(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGateSwitchError(message);
    } finally {
      setGateSwitching(false);
    }
  }, [
    bridgeGateOpen,
    gateSwitching,
    onBridgeGateOpenChange,
    setOverlay,
    targetPortalChain,
    wallet,
  ]);

  useEffect(() => {
    if (!gateSwitching) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setGateSwitching(false);
      setGateSwitchError(
        "Wallet switch is taking too long. Open your wallet to confirm, then retry at the gate.",
      );
    }, GATE_SWITCH_TIMEOUT_MS + 3_000);
    return () => clearTimeout(timeoutId);
  }, [gateSwitching]);

  useEffect(() => {
    if (!selectionMode || selectableMinions.length === 0) {
      return;
    }
    if (swapSelectionMode && !selectedSwapAssetKey) {
      setSwapSelection(selectableMinions[0]!.assetKey);
    }
    if (sendSelectionMode && !selectedSendAssetKey) {
      setSendSelection(selectableMinions[0]!.assetKey);
    }
  }, [
    selectableMinions,
    selectedSendAssetKey,
    selectedSwapAssetKey,
    selectionMode,
    sendSelectionMode,
    setSendSelection,
    setSwapSelection,
    swapSelectionMode,
  ]);

  useEffect(() => {
    if (!selectionMode || selectableMinions.length === 0) {
      return;
    }
    const selectedAssetKey = swapSelectionMode
      ? selectedSwapAssetKey
      : selectedSendAssetKey;
    const onSelectionKey = (event: KeyboardEvent) => {
      const key = event.key;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "Enter"
      ) {
        return;
      }
      event.preventDefault();

      if (key === "Enter") {
        if (swapSelectionMode) {
          setSwapStep("details");
        } else if (sendSelectionMode) {
          setSendStep("details");
        }
        return;
      }

      const currentIndex = Math.max(
        0,
        selectableMinions.findIndex(
          (minion) => minion.assetKey === selectedAssetKey,
        ),
      );
      const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      const nextIndex =
        (currentIndex + direction + selectableMinions.length) %
        selectableMinions.length;
      if (swapSelectionMode) {
        setSwapSelection(selectableMinions[nextIndex]!.assetKey);
      } else if (sendSelectionMode) {
        setSendSelection(selectableMinions[nextIndex]!.assetKey);
      }
    };

    window.addEventListener("keydown", onSelectionKey);
    return () => {
      window.removeEventListener("keydown", onSelectionKey);
    };
  }, [
    selectionMode,
    selectedSendAssetKey,
    selectableMinions,
    selectedSwapAssetKey,
    sendSelectionMode,
    setSendSelection,
    setSendStep,
    setSwapSelection,
    setSwapStep,
    swapSelectionMode,
  ]);

  useEffect(() => {
    const onInteract = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "e") {
        return;
      }
      if (nearBridgeGateRef.current) {
        event.preventDefault();
        void requestBridgeGateUnlock();
        return;
      }
      if (!currentZoneOverlayRef.current) {
        return;
      }
      setOverlay(currentZoneOverlayRef.current);
    };

    window.addEventListener("keydown", onInteract);
    return () => {
      window.removeEventListener("keydown", onInteract);
    };
  }, [requestBridgeGateUnlock, setOverlay]);

  useEffect(() => {
    if (!avatarRef.current || hasSpawnedRef.current) {
      return;
    }
    const spawn = ROOM_SPAWNS[currentRoomId];
    avatarRef.current.position.set(spawn.x, spawn.y, spawn.z);
    hasSpawnedRef.current = true;
  }, [currentRoomId]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const nextDistance =
        cameraDistanceRef.current + event.deltaY * CAMERA_ZOOM_SENSITIVITY;
      cameraDistanceRef.current = Math.max(
        CAMERA_MIN_DISTANCE,
        Math.min(CAMERA_MAX_DISTANCE, nextDistance),
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      pointerDragRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        isDragging: true,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || !drag.isDragging || drag.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - drag.lastX;
      drag.lastX = event.clientX;
      cameraOrbitYawRef.current -= deltaX * CAMERA_ORBIT_SENSITIVITY;
    };

    const stopDrag = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      pointerDragRef.current = null;
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    canvas.addEventListener("pointerleave", stopDrag);
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDrag);
      canvas.removeEventListener("pointercancel", stopDrag);
      canvas.removeEventListener("pointerleave", stopDrag);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [gl]);

  useFrame(({ camera }, delta) => {
    if (!avatarRef.current) {
      return;
    }

    const frameDelta = delta;
    const moveSpeed = AVATAR_MOVE_SPEED * frameDelta;
    const turnLerp = 1 - Math.exp(-frameDelta * 16);
    const orbitYaw = cameraOrbitYawRef.current;
    const cameraForward = cameraForwardRef.current;
    const cameraRight = cameraRightRef.current;
    camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() <= 0.000001) {
      cameraForward.set(Math.sin(orbitYaw), 0, Math.cos(orbitYaw));
    } else {
      cameraForward.normalize();
    }
    cameraRight.crossVectors(WORLD_UP, cameraForward).normalize();
    const inputX = (keys.current["a"] ? 1 : 0) - (keys.current["d"] ? 1 : 0);
    const inputZ = (keys.current["w"] ? 1 : 0) - (keys.current["s"] ? 1 : 0);
    const rawMoveX = cameraRight.x * inputX + cameraForward.x * inputZ;
    const rawMoveZ = cameraRight.z * inputX + cameraForward.z * inputZ;
    const rawMoveLengthSq = rawMoveX * rawMoveX + rawMoveZ * rawMoveZ;
    const rawMoveLength = rawMoveLengthSq > 0 ? Math.sqrt(rawMoveLengthSq) : 1;
    const moveDirX = rawMoveX / rawMoveLength;
    const moveDirZ = rawMoveZ / rawMoveLength;
    const desiredFacingYaw =
      rawMoveLengthSq > 0.000001 ? Math.atan2(moveDirX, moveDirZ) : null;

    let intendedX = avatarRef.current.position.x;
    let intendedZ = avatarRef.current.position.z;

    if (rawMoveLengthSq > 0.000001) {
      intendedX += moveDirX * moveSpeed;
      intendedZ += moveDirZ * moveSpeed;
    }

    const previousX = avatarRef.current.position.x;
    const previousZ = avatarRef.current.position.z;

    const resolved = resolveMovement(
      previousX,
      previousZ,
      Math.max(-128, Math.min(128, intendedX)),
      Math.max(-128, Math.min(128, intendedZ)),
    );

    if (
      !bridgeGateOpen &&
      Math.abs(resolved.z - BRIDGE_CONFIG.walkway.z) <= BRIDGE_GATE_CONFIG.blockHalfZ
    ) {
      if (
        currentRoomId === "ethereum:main" &&
        resolved.x > BRIDGE_CONFIG.position[0] - BRIDGE_GATE_CONFIG.blockHalfX
      ) {
        resolved.x = BRIDGE_CONFIG.position[0] - BRIDGE_GATE_CONFIG.blockHalfX;
      }
      if (
        currentRoomId === "base:main" &&
        resolved.x < BRIDGE_CONFIG.position[0] + BRIDGE_GATE_CONFIG.blockHalfX
      ) {
        resolved.x = BRIDGE_CONFIG.position[0] + BRIDGE_GATE_CONFIG.blockHalfX;
      }
    }

    avatarRef.current.position.x = resolved.x;
    avatarRef.current.position.z = resolved.z;

    const movedX = resolved.x - previousX;
    const movedZ = resolved.z - previousZ;
    const movedDistanceSquared = movedX * movedX + movedZ * movedZ;
    const movedFacingYaw =
      movedDistanceSquared > 0.000001 ? Math.atan2(movedX, movedZ) : null;
    const targetFacingYaw = movedFacingYaw ?? desiredFacingYaw;
    if (targetFacingYaw !== null) {
      avatarRef.current.rotation.y +=
        shortestAngleDelta(avatarRef.current.rotation.y, targetFacingYaw) *
        turnLerp;
    }

    if (groundSurfaces.length > 0) {
      const raycaster = raycasterRef.current;
      const rayOrigin = rayOriginRef.current;
      rayOrigin.set(resolved.x, 40, resolved.z);
      raycaster.set(rayOrigin, rayDirectionRef.current);
      const intersections = raycaster.intersectObjects(groundSurfaces, true);
      const groundHit = intersections.find(
        (hit) => !hasBlockedGroundAncestor(hit.object),
      );
      if (groundHit) {
        const targetY = groundHit.point.y + AVATAR_GROUND_OFFSET;
        avatarRef.current.position.y +=
          (targetY - avatarRef.current.position.y) *
          (1 - Math.exp(-frameDelta * 20));
      }
    }

    const movingNow = movedDistanceSquared > 0.000001;
    if (movingNow !== isMovingRef.current) {
      isMovingRef.current = movingNow;
      setIsMoving(movingNow);
    }

    if (
      currentRoomId === "ethereum:main" &&
      resolved.x >
        BRIDGE_CONFIG.position[0] + BRIDGE_CONFIG.roomSwitch.xThresholdOffset &&
      Math.abs(resolved.z - BRIDGE_CONFIG.walkway.z) <=
        BRIDGE_CONFIG.roomSwitch.zHalfSpan
    ) {
      onBridgeGateOpenChange(false);
      setGateSwitchError(undefined);
      setRoom("base:main");
      setOverlay(undefined);
    }
    if (
      currentRoomId === "base:main" &&
      resolved.x <
        BRIDGE_CONFIG.position[0] - BRIDGE_CONFIG.roomSwitch.xThresholdOffset &&
      Math.abs(resolved.z - BRIDGE_CONFIG.walkway.z) <=
        BRIDGE_CONFIG.roomSwitch.zHalfSpan
    ) {
      onBridgeGateOpenChange(false);
      setGateSwitchError(undefined);
      setRoom("ethereum:main");
      setOverlay(undefined);
    }

    const target = avatarRef.current.position;
    const sideDerivedTargetChain: ChainSlug =
      target.x <= BRIDGE_CONFIG.position[0] ? "base" : "ethereum";
    if (sideDerivedTargetChain !== targetPortalChain) {
      setTargetPortalChain(sideDerivedTargetChain);
    }
    const targetCameraDistance = selectionMode
      ? SWAP_SELECT_CAMERA_DISTANCE
      : cameraDistanceRef.current;
    const targetCameraHeight = selectionMode
      ? SWAP_SELECT_CAMERA_HEIGHT
      : CAMERA_FOLLOW_HEIGHT;
    const cameraDistanceLerp = 1 - Math.exp(-frameDelta * 8);
    cameraPresentationDistanceRef.current +=
      (targetCameraDistance - cameraPresentationDistanceRef.current) *
      cameraDistanceLerp;
    cameraPresentationHeightRef.current +=
      (targetCameraHeight - cameraPresentationHeightRef.current) *
      cameraDistanceLerp;
    const cameraDistance = cameraPresentationDistanceRef.current;
    cameraAnchorRef.current.set(
      target.x - Math.sin(orbitYaw) * cameraDistance,
      target.y + cameraPresentationHeightRef.current,
      target.z - Math.cos(orbitYaw) * cameraDistance,
    );
    if (!didInitCameraRef.current) {
      camera.position.copy(cameraAnchorRef.current);
      lookTargetRef.current.set(target.x, target.y + 1.25, target.z);
      didInitCameraRef.current = true;
    }
    const followLerp = 1 - Math.exp(-frameDelta * 9);
    const lookLerp = 1 - Math.exp(-frameDelta * 14);
    camera.position.lerp(cameraAnchorRef.current, followLerp);
    lookAnchorRef.current.set(target.x, target.y + 1.25, target.z);
    lookTargetRef.current.lerp(lookAnchorRef.current, lookLerp);
    camera.lookAt(lookTargetRef.current);

    const zone = SCENE_INTERACTION_ZONES.find((item) => {
      const matchesRoom = item.roomId === currentRoomId;
      const insideX = Math.abs(target.x - item.position.x) <= item.size.x / 2;
      const insideZ = Math.abs(target.z - item.position.z) <= item.size.z / 2;
      return matchesRoom && insideX && insideZ;
    });

    const inBridgeGateInteractRange =
      Math.abs(target.z - BRIDGE_GATE_CONFIG.position[2]) <=
        BRIDGE_GATE_CONFIG.interactHalfZ &&
      Math.abs(target.x - BRIDGE_GATE_CONFIG.position[0]) <=
        BRIDGE_GATE_CONFIG.interactHalfX &&
      ((currentRoomId === "ethereum:main" &&
        target.x <= BRIDGE_GATE_CONFIG.position[0]) ||
        (currentRoomId === "base:main" &&
          target.x >= BRIDGE_GATE_CONFIG.position[0]));
    if (nearBridgeGateRef.current !== inBridgeGateInteractRange) {
      nearBridgeGateRef.current = inBridgeGateInteractRange;
      setIsNearBridgeGate(inBridgeGateInteractRange);
      if (!inBridgeGateInteractRange) {
        setGateSwitchError(undefined);
      }
    }

    if (zone?.id !== currentZoneId) {
      setCurrentZoneId(zone?.id);
      onZoneChange?.(zone?.id);
      if (!zone) {
        if (
          activeOverlay === "swap" ||
          activeOverlay === "bridge" ||
          activeOverlay === "send"
        ) {
          setOverlay(undefined);
        }
      }
    }

    onPositionChange(
      { x: target.x, y: target.y, z: target.z },
      avatarRef.current.rotation.y,
    );
  });

  return (
    <group ref={avatarRef}>
      <AvatarBody avatarId={avatarId} isMoving={isMoving} />
      <AvatarNameTag label={displayName} visible={labelsVisible} />
      <TokenMinions
        labelsVisible={labelsVisible}
        minions={minions}
        onSelect={handleMinionSelect}
        position={{ x: 0, y: 0, z: 0 }}
        selectionMode={selectionMode}
        selectedAssetKey={
          activeOverlay === "swap"
            ? selectedSwapAssetKey
            : activeOverlay === "send"
              ? selectedSendAssetKey
              : undefined
        }
      />
      {labelsVisible && isNearBridgeGate ? (
        <Html position={[0, 4.3, 0]} center>
          <div className="pointer-events-none border border-amber-200/35 bg-black/60 px-2 py-1 text-white shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2">
              <span className="border border-amber-200/45 bg-amber-200/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                E
              </span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-amber-100/90">
                Portal Gate
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-tight whitespace-nowrap">
              {bridgeGateOpen
                ? "Gate unlocked. Cross the bridge."
                : gateSwitching
                  ? `Switching wallet to ${targetPortalChainLabel}...`
                  : `Unlock gate to ${targetPortalChainLabel}`}
            </p>
            {gateSwitchError ? (
              <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-rose-200/95">
                {gateSwitchError}
              </p>
            ) : null}
          </div>
        </Html>
      ) : null}
      {!isNearBridgeGate && currentZoneOverlay && labelsVisible ? (
        <Html position={[0, 4.2, 0]} center>
          <div className="pointer-events-none border border-emerald-200/35 bg-black/60 px-2 py-1 text-white shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2">
              <span className="border border-emerald-200/45 bg-emerald-200/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                E
              </span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-emerald-100/90">
                Interact
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-tight whitespace-nowrap">
              {currentZone?.label}
            </p>
          </div>
        </Html>
      ) : null}
    </group>
  );
});

function SceneContent({
  avatarId,
  displayName,
}: {
  avatarId?: AvatarId;
  displayName: string;
}) {
  const remote = useAppStore((state) => state.presence.remote);
  const activeOverlay = useAppStore((state) => state.overlays.activeOverlay);
  const setLocalPresence = useAppStore((state) => state.setLocalPresence);
  const session = useAppStore((state) => state.session);
  const minions = useAppStore((state) => state.minions);
  const labelsVisible = !activeOverlay;
  const [localAvatarPosition, setLocalAvatarPosition] = useState<Vector3Like>(
    ROOM_SPAWNS[session.currentRoomId],
  );
  const [bridgeGateOpen, setBridgeGateOpen] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState<string>();
  const lastPublishedPresenceRef = useRef<
    | {
        sentAt: number;
        position: Vector3Like;
        rotationY: number;
        address: string;
        roomId: WorldRoomId;
        chain: PresenceSnapshot["chain"];
        avatarId: AvatarId;
        displayName: string;
        minionsRef: TokenMinion[];
        visibleSymbolsRef: string[];
        totalMinions: number;
      }
    | undefined
  >(undefined);
  const [groundSurfaceMap, setGroundSurfaceMap] = useState<
    Record<string, Object3D>
  >({});
  const remotePlayers = useMemo(() => {
    const localAddress = session.connectedAddress?.toLowerCase();
    if (!localAddress) {
      return Object.entries(remote);
    }

    return Object.entries(remote).filter(
      ([, snapshot]) => snapshot.address.toLowerCase() !== localAddress,
    );
  }, [remote, session.connectedAddress]);
  const groundSurfaces = useMemo(
    () => Object.values(groundSurfaceMap),
    [groundSurfaceMap],
  );
  useEffect(() => {
    if (avatarId) {
      return;
    }
    setLocalAvatarPosition(ROOM_SPAWNS[session.currentRoomId]);
  }, [avatarId, session.currentRoomId]);
  useEffect(() => {
    if (avatarId) {
      return;
    }
    setActiveZoneId(undefined);
  }, [avatarId, session.currentRoomId]);
  useEffect(() => {
    setBridgeGateOpen(false);
  }, [session.currentRoomId]);
  const setGroundSurface = useCallback(
    (surfaceId: string, object?: Object3D) => {
      setGroundSurfaceMap((current) => {
        if (!object) {
          if (!(surfaceId in current)) {
            return current;
          }
          const { [surfaceId]: _removed, ...rest } = current;
          return rest;
        }

        if (current[surfaceId] === object) {
          return current;
        }
        return { ...current, [surfaceId]: object };
      });
    },
    [],
  );
  const publishPresence = useCallback(
    (position: Vector3Like, rotationY: number) => {
      setLocalAvatarPosition((current) => {
        const dx = position.x - current.x;
        const dz = position.z - current.z;
        if (dx * dx + dz * dz < 0.35 * 0.35) {
          return current;
        }
        return { ...position };
      });
      if (!session.connectedAddress || !avatarId) {
        return;
      }

      const now = Date.now();
      const previous = lastPublishedPresenceRef.current;
      const movedDistanceSq = previous
        ? (position.x - previous.position.x) *
            (position.x - previous.position.x) +
          (position.z - previous.position.z) *
            (position.z - previous.position.z)
        : Number.POSITIVE_INFINITY;
      const rotationDelta = previous
        ? Math.abs(shortestAngleDelta(previous.rotationY, rotationY))
        : Number.POSITIVE_INFINITY;
      const contextChanged =
        !previous ||
        previous.address !== session.connectedAddress ||
        previous.roomId !== session.currentRoomId ||
        previous.chain !== session.activeChain ||
        previous.avatarId !== avatarId ||
        previous.displayName !== displayName ||
        previous.minionsRef !== minions.list ||
        previous.visibleSymbolsRef !== minions.visibleSymbols ||
        previous.totalMinions !== minions.total;
      const minionsChanged =
        !previous ||
        previous.minionsRef !== minions.list ||
        previous.visibleSymbolsRef !== minions.visibleSymbols ||
        previous.totalMinions !== minions.total;
      const publishForMotion =
        (!previous || now - previous.sentAt >= PRESENCE_PUBLISH_INTERVAL_MS) &&
        (movedDistanceSq >= PRESENCE_MIN_DISTANCE_DELTA_SQ ||
          rotationDelta >= PRESENCE_MIN_ROTATION_DELTA);

      if (!contextChanged && !publishForMotion) {
        return;
      }

      setLocalPresence({
        address: session.connectedAddress,
        roomId: session.currentRoomId,
        displayName,
        avatarId,
        chain: session.activeChain,
        interactionStatus: "exploring",
        minionSummary: {
          total: minions.total,
          visibleSymbols: minions.visibleSymbols,
        },
        minions: minionsChanged ? minions.list : undefined,
        position,
        rotation: { x: 0, y: rotationY, z: 0 },
        updatedAt: now,
      });
      lastPublishedPresenceRef.current = {
        sentAt: now,
        position: { ...position },
        rotationY,
        address: session.connectedAddress,
        roomId: session.currentRoomId,
        chain: session.activeChain,
        avatarId,
        displayName,
        minionsRef: minions.list,
        visibleSymbolsRef: minions.visibleSymbols,
        totalMinions: minions.total,
      };
    },
    [
      avatarId,
      displayName,
      minions.list,
      minions.total,
      minions.visibleSymbols,
      session.activeChain,
      session.connectedAddress,
      session.currentRoomId,
      setLocalPresence,
    ],
  );

  return (
    <>
      <fog attach="fog" args={["#0b1a24", 50, 240]} />
      <ambientLight intensity={0.74} />
      <hemisphereLight args={["#a7cde2", "#223834", 0.75]} />
      <directionalLight
        castShadow
        intensity={1.4}
        position={[26, 30, 20]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.06}
      />
      <pointLight color="#a9cdf1" intensity={1} position={[-52, 12, 0]} />
      <pointLight color="#9ad5f8" intensity={1} position={[52, 12, 0]} />
      <Sky sunPosition={[120, 18, 100]} />
      <WaterPlane />
      <Suspense fallback={null}>
        <WorldProps
          bridgeGateOpen={bridgeGateOpen}
          currentRoomId={session.currentRoomId}
          labelsVisible={labelsVisible}
          onGroundSurfaceChange={setGroundSurface}
          referencePosition={localAvatarPosition}
        />
        {avatarId ? (
          <Avatar
            avatarId={avatarId}
            bridgeGateOpen={bridgeGateOpen}
            displayName={displayName}
            groundSurfaces={groundSurfaces}
            labelsVisible={labelsVisible}
            onBridgeGateOpenChange={setBridgeGateOpen}
            onZoneChange={setActiveZoneId}
            onPositionChange={publishPresence}
          />
        ) : null}
        {remotePlayers.map(([connectionId, snapshot]) => (
          <RemoteAvatar
            key={connectionId}
            labelsVisible={labelsVisible}
            snapshot={snapshot}
          />
        ))}
      </Suspense>
      <ZonePads
        hiddenZoneId={activeZoneId}
        labelsVisible={labelsVisible}
        referencePosition={localAvatarPosition}
        roomId={session.currentRoomId}
      />
    </>
  );
}

export function CryptoWorldScene({
  avatarId,
  displayName,
}: {
  avatarId?: AvatarId;
  displayName: string;
}) {
  return (
    <Canvas
      camera={{ far: 260, fov: 62, near: 0.4, position: [0, 9, -10] }}
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      shadows
    >
      <SceneContent avatarId={avatarId} displayName={displayName} />
    </Canvas>
  );
}
