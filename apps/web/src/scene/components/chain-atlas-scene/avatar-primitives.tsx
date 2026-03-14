import {
  type AvatarId,
  type PresenceSnapshot,
  type TokenMinion,
} from "@chainatlas/shared";
import { Html, useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Mesh,
  Object3D,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  ACTION_FLOATING_TEXT_TTL_MS,
  CHARACTER_MODEL_BY_ID,
  REMOTE_HARD_SNAP_DISTANCE,
  REMOTE_MINION_RENDER_LIMIT,
  REMOTE_MOVEMENT_EPSILON,
  REMOTE_MOVEMENT_IDLE_GRACE_MS,
  REMOTE_POSITION_LERP_SPEED,
  REMOTE_ROTATION_LERP_SPEED,
  getInteractionFloatingLabel,
} from "./config";
import { TokenMinions } from "./minions";
import { shortestAngleDelta } from "./movement";

export function AvatarNameTag({
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

export function AvatarBody({
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

export function RemoteAvatar({
  labelsVisible,
  onInteract,
  showFloatingText,
  snapshot,
}: {
  snapshot: PresenceSnapshot;
  labelsVisible: boolean;
  showFloatingText: boolean;
  onInteract?(address: string): void;
}) {
  const groupRef = useRef<Group>(null);
  const targetPositionRef = useRef(
    new Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z),
  );
  const renderedPositionRef = useRef(
    new Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z),
  );
  const targetRotationRef = useRef({
    x: snapshot.rotation.x,
    y: snapshot.rotation.y,
    z: snapshot.rotation.z,
  });
  const renderedRotationYRef = useRef(snapshot.rotation.y);
  const lastNetworkUpdateAtRef = useRef(snapshot.updatedAt);
  const isMovingRef = useRef(false);
  const [isMoving, setIsMoving] = useState(false);
  const [shoutText, setShoutText] = useState<string>();
  const [actionText, setActionText] = useState<string>();
  const remoteMinions = useMemo<TokenMinion[]>(
    () =>
      (snapshot.minions ?? [])
        .slice(0, REMOTE_MINION_RENDER_LIMIT)
        .map((minion, index) => ({
          id: `remote:${snapshot.address}:${index}:${minion.name}`,
          assetKey: `remote:${snapshot.address}:${minion.name}:${index}`,
          chain: snapshot.chain,
          symbol: minion.name,
          name: minion.name,
          balance: minion.amount,
          usdValue: 0,
          hue: (index * 43 + minion.name.charCodeAt(0)) % 360,
          scale: 0.82,
          orbitRadius: 1.2 + index * 0.34,
          bobOffset: index * 0.6,
          priority: index,
          actionable: false,
        })),
    [snapshot.address, snapshot.chain, snapshot.minions],
  );

  useEffect(() => {
    targetPositionRef.current.set(
      snapshot.position.x,
      snapshot.position.y,
      snapshot.position.z,
    );
    targetRotationRef.current = {
      x: snapshot.rotation.x,
      y: snapshot.rotation.y,
      z: snapshot.rotation.z,
    };
    lastNetworkUpdateAtRef.current = snapshot.updatedAt;

    const group = groupRef.current;
    const snapDistance = renderedPositionRef.current.distanceTo(
      targetPositionRef.current,
    );
    if (snapDistance > REMOTE_HARD_SNAP_DISTANCE) {
      renderedPositionRef.current.copy(targetPositionRef.current);
      if (group) {
        group.position.copy(renderedPositionRef.current);
      }
    }

    const snapRotationDelta = Math.abs(
      shortestAngleDelta(renderedRotationYRef.current, snapshot.rotation.y),
    );
    if (snapRotationDelta > Math.PI * 0.8) {
      renderedRotationYRef.current = snapshot.rotation.y;
      if (group) {
        group.rotation.set(
          snapshot.rotation.x,
          renderedRotationYRef.current,
          snapshot.rotation.z,
        );
      }
    }
  }, [
    snapshot.position.x,
    snapshot.position.y,
    snapshot.position.z,
    snapshot.rotation.x,
    snapshot.rotation.y,
    snapshot.rotation.z,
    snapshot.updatedAt,
  ]);

  useEffect(() => {
    if (
      typeof snapshot.shoutText !== "string" ||
      typeof snapshot.shoutExpiresAt !== "number" ||
      snapshot.shoutExpiresAt <= Date.now()
    ) {
      setShoutText(undefined);
      return;
    }

    setShoutText(snapshot.shoutText);
    const timeoutMs = Math.max(0, snapshot.shoutExpiresAt - Date.now());
    const timeoutId = window.setTimeout(() => {
      setShoutText(undefined);
    }, timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [snapshot.shoutExpiresAt, snapshot.shoutText, snapshot.updatedAt]);

  useEffect(() => {
    const label = getInteractionFloatingLabel(snapshot.interactionStatus);
    if (!label) {
      setActionText(undefined);
      return;
    }

    setActionText(label);
    const timeoutId = window.setTimeout(() => {
      setActionText(undefined);
    }, ACTION_FLOATING_TEXT_TTL_MS);
    return () => window.clearTimeout(timeoutId);
  }, [snapshot.interactionStatus, snapshot.updatedAt]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    const positionLerp = 1 - Math.exp(-REMOTE_POSITION_LERP_SPEED * delta);
    renderedPositionRef.current.lerp(targetPositionRef.current, positionLerp);
    group.position.copy(renderedPositionRef.current);

    const rotationDelta = shortestAngleDelta(
      renderedRotationYRef.current,
      targetRotationRef.current.y,
    );
    const rotationLerp = 1 - Math.exp(-REMOTE_ROTATION_LERP_SPEED * delta);
    renderedRotationYRef.current += rotationDelta * rotationLerp;
    group.rotation.set(
      targetRotationRef.current.x,
      renderedRotationYRef.current,
      targetRotationRef.current.z,
    );

    const unresolvedDistanceSq = renderedPositionRef.current.distanceToSquared(
      targetPositionRef.current,
    );
    const hasRecentNetworkUpdate =
      Date.now() - lastNetworkUpdateAtRef.current <
      REMOTE_MOVEMENT_IDLE_GRACE_MS;
    const movingNow =
      unresolvedDistanceSq >
        REMOTE_MOVEMENT_EPSILON * REMOTE_MOVEMENT_EPSILON ||
      (hasRecentNetworkUpdate && Math.abs(rotationDelta) > 0.02);

    if (movingNow !== isMovingRef.current) {
      isMovingRef.current = movingNow;
      setIsMoving(movingNow);
    }
  });

  const floatingText = shoutText ?? actionText;

  return (
    <group
      ref={groupRef}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onInteract?.(snapshot.address);
      }}
    >
      <AvatarBody avatarId={snapshot.avatarId} isMoving={isMoving} />
      {showFloatingText && remoteMinions.length > 0 ? (
        <TokenMinions
          labelsVisible={false}
          minions={remoteMinions}
          position={{ x: 0, y: 0, z: 0 }}
        />
      ) : null}
      <AvatarNameTag label={snapshot.displayName} visible={labelsVisible} />
      {labelsVisible && showFloatingText && floatingText ? (
        <Html position={[0, 3.2, 0]} center>
          <p className="pointer-events-none px-2 text-center text-[13px] font-semibold text-cyan-50 drop-shadow-[0_1px_8px_rgba(0,0,0,0.75)]">
            {floatingText}
          </p>
        </Html>
      ) : null}
    </group>
  );
}
