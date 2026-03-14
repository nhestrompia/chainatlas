import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConeGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from "three";
import { type TokenMinion, type Vector3Like } from "@chainatlas/shared";
import { formatTokenAmount } from "@/lib/utils/format-token-amount";
import { MINION_SIZE_MULTIPLIER } from "./config";

function formatMinionBalance(balance: string) {
  return formatTokenAmount(balance, 3);
}

export function TokenMinions({
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
  const hoverLeaveTimeoutRef = useRef<number | null>(null);
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

  useEffect(() => {
    return () => {
      if (hoverLeaveTimeoutRef.current !== null) {
        window.clearTimeout(hoverLeaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (labelsVisible && !selectionMode) {
      return;
    }
    if (hoverLeaveTimeoutRef.current !== null) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
      hoverLeaveTimeoutRef.current = null;
    }
    setIsHovered(false);
  }, [labelsVisible, selectionMode]);

  const handlePointerEnter = (event: ThreeEvent<PointerEvent>) => {
    if (!labelsVisible || selectionMode) {
      return;
    }
    event.stopPropagation();
    if (hoverLeaveTimeoutRef.current !== null) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
      hoverLeaveTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handlePointerLeave = () => {
    if (hoverLeaveTimeoutRef.current !== null) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
    }
    hoverLeaveTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      hoverLeaveTimeoutRef.current = null;
    }, 80);
  };

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.(minion);
  };

  return (
    <group
      ref={ref}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerEnter}
      onClick={handleSelect}
    >
      <mesh
        castShadow
        geometry={geometryPool.body}
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
            <p
              className="max-w-[140px] truncate text-[14px] font-semibold leading-tight"
              title={minion.symbol}
            >
              {minion.symbol}
            </p>
            <p className="text-[11px] tabular-nums text-cyan-100/90">
              {formatMinionBalance(minion.balance)}
            </p>
          </div>
        </Html>
      ) : null}
      {showHoverLabel ? (
        <Html position={[0, 0.5, 0]} center distanceFactor={12}>
          <div className="pointer-events-none min-w-[180px] rounded-2xl border border-cyan-100/25 bg-[#0d1720]/90 px-3 py-2 text-[11px] text-cyan-50 shadow-xl">
            <p
              className="truncate font-semibold"
              title={`${minion.symbol} | ${minion.chain}`}
            >
              {minion.symbol} | {minion.chain}
            </p>
            <p className="truncate text-cyan-100/85" title={minion.name}>
              {minion.name}
            </p>
            <p
              className="mt-1 truncate font-medium tabular-nums"
              title={`${formatMinionBalance(minion.balance)} ${minion.symbol}`}
            >
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
