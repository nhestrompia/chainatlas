import { Sky } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Object3D } from "three";
import {
  type AvatarId,
  type PresenceSnapshot,
  type TokenMinion,
  type Vector3Like,
  type WorldRoomId,
} from "@chainatlas/shared";
import { useAppStore } from "@/lib/store/app-store";
import {
  PRESENCE_MIN_DISTANCE_DELTA_SQ,
  PRESENCE_MIN_ROTATION_DELTA,
  PRESENCE_PUBLISH_INTERVAL_MS,
  REMOTE_FLOATING_TEXT_RANGE,
  ROOM_SPAWNS,
  SOCKET_MINION_LIMIT,
  SOCKET_VISIBLE_SYMBOL_LIMIT,
} from "./config";
import { shortestAngleDelta } from "./movement";
import { Avatar } from "./avatar-controller";
import { RemoteAvatar } from "./avatar-primitives";
import { LiveMarketBoard3D } from "./live-market-board";
import { WaterPlane, WorldProps, ZonePads } from "./world-props";

export function SceneContent({
  avatarId,
  displayName,
}: {
  avatarId?: AvatarId;
  displayName: string;
}) {
  const remote = useAppStore((state) => state.presence.remote);
  const activeOverlay = useAppStore((state) => state.overlays.activeOverlay);
  const setOverlay = useAppStore((state) => state.setOverlay);
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
        interactionStatus: PresenceSnapshot["interactionStatus"];
        shoutText?: string;
        shoutExpiresAt?: number;
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
      const existingLocalPresence = useAppStore.getState().presence.local;
      const activeInteractionStatus =
        existingLocalPresence?.interactionStatus &&
        existingLocalPresence.interactionStatus !== "idle"
          ? existingLocalPresence.interactionStatus
          : "exploring";
      const activeShout =
        typeof existingLocalPresence?.shoutText === "string" &&
        typeof existingLocalPresence?.shoutExpiresAt === "number" &&
        existingLocalPresence.shoutExpiresAt > now
          ? {
              text: existingLocalPresence.shoutText,
              expiresAt: existingLocalPresence.shoutExpiresAt,
            }
          : undefined;
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
        previous.totalMinions !== minions.total ||
        previous.interactionStatus !== activeInteractionStatus ||
        previous.shoutText !== activeShout?.text ||
        previous.shoutExpiresAt !== activeShout?.expiresAt;
      const minionsChanged =
        !previous ||
        previous.minionsRef !== minions.list ||
        previous.visibleSymbolsRef !== minions.visibleSymbols ||
        previous.totalMinions !== minions.total;
      const socketMinions = minionsChanged
        ? minions.list.slice(0, SOCKET_MINION_LIMIT).map((minion) => ({
            name: minion.symbol,
            amount: minion.balance,
          }))
        : undefined;
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
        interactionStatus: activeInteractionStatus,
        minionSummary: {
          total: minions.total,
          visibleSymbols: minions.visibleSymbols.slice(
            0,
            SOCKET_VISIBLE_SYMBOL_LIMIT,
          ),
        },
        minions: socketMinions,
        shoutText: activeShout?.text,
        shoutExpiresAt: activeShout?.expiresAt,
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
        interactionStatus: activeInteractionStatus,
        shoutText: activeShout?.text,
        shoutExpiresAt: activeShout?.expiresAt,
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
  const handleRemoteAvatarInteract = useCallback(
    (targetAddress: string) => {
      setOverlay("player", targetAddress);
    },
    [setOverlay],
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
      <LiveMarketBoard3D />
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
          // Show transient floating text only for nearby players to reduce noise.
          <RemoteAvatar
            key={connectionId}
            labelsVisible={labelsVisible}
            onInteract={handleRemoteAvatarInteract}
            showFloatingText={
              Math.hypot(
                snapshot.position.x - localAvatarPosition.x,
                snapshot.position.z - localAvatarPosition.z,
              ) <= REMOTE_FLOATING_TEXT_RANGE
            }
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
