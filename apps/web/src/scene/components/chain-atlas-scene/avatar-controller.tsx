import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Group, Object3D, Raycaster, Vector3 } from "three";
import {
  ensureWalletChain,
  isLikelyEmbeddedWallet,
  usePrivyWallet,
} from "@/features/wallet/use-privy-wallet";
import { useAppStore } from "@/lib/store/app-store";
import {
  type AvatarId,
  type ChainSlug,
  type TokenMinion,
  type Vector3Like,
} from "@chainatlas/shared";
import {
  AVATAR_GROUND_OFFSET,
  AVATAR_MOVE_SPEED,
  BRIDGE_CONFIG,
  BRIDGE_GATE_CONFIG,
  CAMERA_FOLLOW_DISTANCE,
  CAMERA_FOLLOW_HEIGHT,
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_ORBIT_SENSITIVITY,
  CAMERA_ZOOM_SENSITIVITY,
  GATE_SWITCH_TIMEOUT_MS,
  ROOM_SPAWNS,
  SCENE_INTERACTION_ZONES,
  SWAP_SELECT_CAMERA_DISTANCE,
  SWAP_SELECT_CAMERA_HEIGHT,
  shortenAddress,
} from "./config";
import {
  getOverlayForZone,
  hasBlockedGroundAncestor,
  isTypingTarget,
  resolveMovement,
  shortestAngleDelta,
} from "./movement";
import { AvatarBody, AvatarNameTag } from "./avatar-primitives";
import { TokenMinions } from "./minions";

const WORLD_UP = new Vector3(0, 1, 0);

export const Avatar = memo(function Avatar({
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
  const setBridgeSelection = useAppStore((state) => state.setBridgeSelection);
  const setBridgeStep = useAppStore((state) => state.setBridgeStep);
  const setRoom = useAppStore((state) => state.setRoom);
  const activeOverlay = useAppStore((state) => state.overlays.activeOverlay);
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const nearbyTargetLabel = useAppStore((state) => {
    const target = state.overlays.nearbyTarget?.toLowerCase();
    if (!target) {
      return undefined;
    }
    const snapshot = Object.values(state.presence.remote).find(
      (presence) => presence.address.toLowerCase() === target,
    );
    return snapshot?.displayName;
  });
  const swapStep = useAppStore((state) => state.overlays.swapStep);
  const sendStep = useAppStore((state) => state.overlays.sendStep);
  const bridgeStep = useAppStore((state) => state.overlays.bridgeStep);
  const selectedSwapAssetKey = useAppStore(
    (state) => state.overlays.swapSelectedAssetKey,
  );
  const selectedSendAssetKey = useAppStore(
    (state) => state.overlays.sendSelectedAssetKey,
  );
  const selectedBridgeAssetKey = useAppStore(
    (state) => state.overlays.bridgeSelectedAssetKey,
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
  const bridgeSelectionMode = activeOverlay === "bridge" && bridgeStep !== "details";
  const selectionMode =
    swapSelectionMode || sendSelectionMode || bridgeSelectionMode;
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
      const bridgeContext = bridgeSelectionMode || zoneOverlay === "bridge";
      if ((!swapContext && !sendContext && !bridgeContext) || minion.chain !== activeChain) {
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

      if (bridgeContext) {
        setBridgeSelection(minion.assetKey);
        if (activeOverlay !== "bridge") {
          setOverlay("bridge");
          setBridgeStep("select");
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
      sendSelectionMode,
      setOverlay,
      setBridgeSelection,
      setBridgeStep,
      setSendSelection,
      setSendStep,
      setSwapSelection,
      setSwapStep,
      bridgeSelectionMode,
      swapSelectionMode,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      keys.current[event.key.toLowerCase()] = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      keys.current[event.key.toLowerCase()] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

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
    if (bridgeSelectionMode && !selectedBridgeAssetKey) {
      setBridgeSelection(selectableMinions[0]!.assetKey);
    }
  }, [
    bridgeSelectionMode,
    selectedBridgeAssetKey,
    selectableMinions,
    selectedSendAssetKey,
    selectedSwapAssetKey,
    selectionMode,
    setBridgeSelection,
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
      : sendSelectionMode
        ? selectedSendAssetKey
        : selectedBridgeAssetKey;
    const onSelectionKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
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
        } else if (bridgeSelectionMode) {
          setBridgeStep("details");
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
      } else if (bridgeSelectionMode) {
        setBridgeSelection(selectableMinions[nextIndex]!.assetKey);
      }
    };

    window.addEventListener("keydown", onSelectionKey);
    return () => {
      window.removeEventListener("keydown", onSelectionKey);
    };
  }, [
    bridgeSelectionMode,
    selectedBridgeAssetKey,
    selectionMode,
    selectedSendAssetKey,
    selectableMinions,
    selectedSwapAssetKey,
    setBridgeSelection,
    setBridgeStep,
    sendSelectionMode,
    setSendSelection,
    setSendStep,
    setSwapSelection,
    setSwapStep,
    swapSelectionMode,
  ]);

  useEffect(() => {
    const onInteract = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.repeat || event.key.toLowerCase() !== "e") {
        return;
      }
      const zoneOverlay = currentZoneOverlayRef.current;
      if (nearBridgeGateRef.current) {
        event.preventDefault();
        void requestBridgeGateUnlock();
        return;
      }
      if (zoneOverlay) {
        event.preventDefault();
        setOverlay(zoneOverlay);
        return;
      }
      if (!nearbyTarget) {
        return;
      }
      event.preventDefault();
      setOverlay("player", nearbyTarget);
    };

    window.addEventListener("keydown", onInteract);
    return () => {
      window.removeEventListener("keydown", onInteract);
    };
  }, [nearbyTarget, requestBridgeGateUnlock, setOverlay]);

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
      Math.abs(resolved.z - BRIDGE_CONFIG.walkway.z) <=
        BRIDGE_GATE_CONFIG.blockHalfZ
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
    currentZoneOverlayRef.current = getOverlayForZone(zone);

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
          (activeOverlay === "send" && !nearbyTarget)
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
              : activeOverlay === "bridge"
                ? selectedBridgeAssetKey
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
      {!isNearBridgeGate &&
      !currentZoneOverlay &&
      nearbyTarget &&
      labelsVisible ? (
        <Html position={[0, 4.2, 0]} center>
          <div className="pointer-events-none border border-sky-200/35 bg-black/60 px-2 py-1 text-white shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2">
              <span className="border border-sky-200/45 bg-sky-200/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                E
              </span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-sky-100/90">
                Interact
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-tight whitespace-nowrap">
              Interact with {nearbyTargetLabel ?? shortenAddress(nearbyTarget)}
            </p>
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
