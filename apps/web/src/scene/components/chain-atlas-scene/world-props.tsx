import { Html, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  AnimationAction,
  AnimationMixer,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  LoopOnce,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { type Vector3Like, type WorldRoomId } from "@chainatlas/shared";
import {
  BRIDGE_CONFIG,
  BRIDGE_GATE_CONFIG,
  getBuildingRotationY,
  LABEL_BUILDING_RANGE,
  LABEL_ISLAND_RANGE,
  LABEL_ZONE_RANGE,
  SCENE_INTERACTION_ZONES,
  type Vec3Tuple,
  type ZoneConfig,
  WORLD_ASSETS,
} from "./config";

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
  const gltf = useGLTF(WORLD_ASSETS.gateGlbUrl);
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
      const exactNameSet = new Set(
        exactNames.map((name) => name.toLowerCase()),
      );
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

export function WaterPlane() {
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

export const ZonePads = memo(function ZonePads({
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

export const WorldProps = memo(function WorldProps({
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
      {WORLD_ASSETS.ISLAND_NODES.map((island) => (
        <group key={island.label}>
          <ModelInstance
            onObjectChange={(object) =>
              onGroundSurfaceChange(`island:${island.label}`, object)
            }
            position={island.position}
            rotation={[0, 0, 0]}
            scale={[
              WORLD_ASSETS.ISLAND_SCALE,
              WORLD_ASSETS.ISLAND_SCALE,
              WORLD_ASSETS.ISLAND_SCALE,
            ]}
            url={WORLD_ASSETS.planeGlbUrl}
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
        url={WORLD_ASSETS.bridgeGlbUrl}
      />
      <GatePortal open={bridgeGateOpen} />

      {WORLD_ASSETS.FUNCTIONAL_BUILDINGS.map((building) => (
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
    </group>
  );
});
