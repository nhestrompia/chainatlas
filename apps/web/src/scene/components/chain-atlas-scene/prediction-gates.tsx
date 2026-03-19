import { fetchPredictionMarkets } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import type { PredictionMarket } from "@chainatlas/shared";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group, Mesh, MeshStandardMaterial } from "three";
import { PREDICTION_PLAZA, type Vec3Tuple } from "./config";

const POLL_INTERVAL_MS = 30_000;
const BUY_EFFECT_DURATION_MS = 1_200;
const BUY_INTENT_EVENT = "prediction:buy-intent";
const YES_COLOR = "#22c55e";
const NO_COLOR = "#ef4444";
const YES_EMISSIVE = "#34d399";
const NO_EMISSIVE = "#fb7185";
const FRAME_COLOR = "#334155";
const FRAME_EDGE = "#64748b";
const PLATFORM_COLOR = "#475569";
const PLATFORM_TOP = "#64748b";
const PLATFORM_Y = -0.4;

type BuySide = "yes" | "no";
type BuyEffect = {
  side: BuySide;
  startedAtMs: number;
};
type BuyIntentEventDetail = {
  side: BuySide;
  marketIndex: number;
  amount: number;
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function GatePair({
  buyEffect,
  market,
  position,
  rotationY,
}: {
  buyEffect?: BuyEffect;
  market?: PredictionMarket;
  position: Vec3Tuple;
  rotationY: number;
}) {
  const groupRef = useRef<Group>(null);
  const yesMaterialRef = useRef<MeshStandardMaterial>(null);
  const noMaterialRef = useRef<MeshStandardMaterial>(null);
  const topBeamMaterialRef = useRef<MeshStandardMaterial>(null);
  const yesPanelRef = useRef<Mesh>(null);
  const noPanelRef = useRef<Mesh>(null);

  const { gateWidth, gateHeight, gateDepth, gateSpacing } = PREDICTION_PLAZA;
  const halfOffset = (gateWidth + gateSpacing) / 2;

  const question = market?.question ?? "Loading...";
  const yesPercent = market ? formatPercent(market.yesPrice) : "...";
  const noPercent = market ? formatPercent(market.noPrice) : "...";
  const volume = market ? formatVolume(market.volume) : "Updating";
  const yesDominant = market ? market.yesPrice >= market.noPrice : false;

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const pulse = 0.28 + Math.sin(elapsed * 1.8) * 0.12;
    const dim = 0.14 + Math.sin(elapsed * 1.8) * 0.05;
    const boostWindowMs = buyEffect ? Date.now() - buyEffect.startedAtMs : Number.POSITIVE_INFINITY;
    const boostProgress = buyEffect
      ? Math.max(0, Math.min(1, 1 - boostWindowMs / BUY_EFFECT_DURATION_MS))
      : 0;
    const boost = boostProgress * boostProgress;
    const yesBoost = buyEffect?.side === "yes" ? boost : boost * 0.35;
    const noBoost = buyEffect?.side === "no" ? boost : boost * 0.35;

    if (yesMaterialRef.current) {
      yesMaterialRef.current.emissiveIntensity =
        (yesDominant ? pulse : dim) + yesBoost * 0.85;
    }
    if (noMaterialRef.current) {
      noMaterialRef.current.emissiveIntensity =
        (yesDominant ? dim : pulse) + noBoost * 0.85;
    }
    if (topBeamMaterialRef.current) {
      topBeamMaterialRef.current.emissiveIntensity =
        0.12 + Math.sin(elapsed * 1.4) * 0.04 + boost * 0.2;
    }
    if (yesPanelRef.current) {
      const s = 1 + yesBoost * 0.07;
      yesPanelRef.current.scale.set(s, s, 1);
    }
    if (noPanelRef.current) {
      const s = 1 + noBoost * 0.07;
      noPanelRef.current.scale.set(s, s, 1);
    }
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + boost * 0.08;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      {/* Ground platform */}
      <mesh receiveShadow position={[0, PLATFORM_Y, 0]}>
        <boxGeometry
          args={[gateWidth * 2 + gateSpacing + 2.4, 0.24, gateDepth + 2.8]}
        />
        <meshStandardMaterial
          color={PLATFORM_COLOR}
          emissive="#334155"
          emissiveIntensity={0.05}
          metalness={0.2}
          roughness={0.55}
        />
      </mesh>
      <mesh receiveShadow position={[0, PLATFORM_Y + 0.12, 0]}>
        <boxGeometry
          args={[gateWidth * 2 + gateSpacing + 1.5, 0.08, gateDepth + 1.8]}
        />
        <meshStandardMaterial
          color={PLATFORM_TOP}
          emissive="#64748b"
          emissiveIntensity={0.04}
          metalness={0.15}
          roughness={0.5}
        />
      </mesh>

      {/* Question banner */}
      <Text
        anchorX="center"
        anchorY="bottom"
        color="#e2e8f0"
        fontSize={0.5}
        maxWidth={12}
        position={[0, gateHeight + 0.72, 0]}
        textAlign="center"
      >
        {question}
      </Text>

      {/* Volume */}
      <Text
        anchorX="center"
        anchorY="top"
        color="#cbd5e1"
        fontSize={0.3}
        position={[0, PLATFORM_Y + 0.03, gateDepth / 2 + 1.02]}
      >
        {`Vol ${volume}`}
      </Text>

      {/* YES gate */}
      <group position={[-halfOffset, gateHeight / 2, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry
            args={[gateWidth + 0.45, gateHeight + 0.45, gateDepth + 0.18]}
          />
          <meshStandardMaterial
            color={FRAME_COLOR}
            emissive="#1e293b"
            emissiveIntensity={0.06}
            metalness={0.2}
            roughness={0.52}
          />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0, -0.02]}>
          <boxGeometry
            args={[gateWidth + 0.12, gateHeight + 0.12, gateDepth - 0.08]}
          />
          <meshStandardMaterial
            color={FRAME_EDGE}
            emissive="#334155"
            emissiveIntensity={0.04}
            metalness={0.15}
            roughness={0.5}
          />
        </mesh>
        <mesh
          ref={yesPanelRef}
          castShadow
          receiveShadow
          position={[0, 0, gateDepth / 2 + 0.14]}
        >
          <boxGeometry args={[gateWidth - 0.58, gateHeight - 0.58, 0.028]} />
          <meshStandardMaterial
            ref={yesMaterialRef}
            color={YES_COLOR}
            emissive={YES_EMISSIVE}
            emissiveIntensity={0.34}
            metalness={0.04}
            roughness={0.22}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#ecfdf5"
          fontSize={0.54}
          position={[0, 0.92, gateDepth / 2 + 0.24]}
        >
          YES
        </Text>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#ffffff"
          fontSize={0.82}
          fontWeight="bold"
          position={[0, -0.08, gateDepth / 2 + 0.24]}
        >
          {yesPercent}
        </Text>
      </group>

      {/* NO gate */}
      <group position={[halfOffset, gateHeight / 2, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry
            args={[gateWidth + 0.45, gateHeight + 0.45, gateDepth + 0.18]}
          />
          <meshStandardMaterial
            color={FRAME_COLOR}
            emissive="#1e293b"
            emissiveIntensity={0.06}
            metalness={0.2}
            roughness={0.52}
          />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0, -0.02]}>
          <boxGeometry
            args={[gateWidth + 0.12, gateHeight + 0.12, gateDepth - 0.08]}
          />
          <meshStandardMaterial
            color={FRAME_EDGE}
            emissive="#334155"
            emissiveIntensity={0.04}
            metalness={0.15}
            roughness={0.5}
          />
        </mesh>
        <mesh
          ref={noPanelRef}
          castShadow
          receiveShadow
          position={[0, 0, gateDepth / 2 + 0.14]}
        >
          <boxGeometry args={[gateWidth - 0.58, gateHeight - 0.58, 0.028]} />
          <meshStandardMaterial
            ref={noMaterialRef}
            color={NO_COLOR}
            emissive={NO_EMISSIVE}
            emissiveIntensity={0.34}
            metalness={0.04}
            roughness={0.22}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#fff1f2"
          fontSize={0.54}
          position={[0, 0.92, gateDepth / 2 + 0.24]}
        >
          NO
        </Text>
        <Text
          anchorX="center"
          anchorY="middle"
          color="#ffffff"
          fontSize={0.82}
          fontWeight="bold"
          position={[0, -0.08, gateDepth / 2 + 0.24]}
        >
          {noPercent}
        </Text>
      </group>

      {/* Divider pillar between gates */}
      <mesh castShadow receiveShadow position={[0, gateHeight / 2, 0]}>
        <boxGeometry args={[0.36, gateHeight + 0.3, gateDepth + 0.08]} />
        <meshStandardMaterial
          color={FRAME_EDGE}
          emissive="#334155"
          emissiveIntensity={0.05}
          metalness={0.14}
          roughness={0.52}
        />
      </mesh>

      {/* Top beam */}
      <mesh castShadow receiveShadow position={[0, gateHeight + 0.28, 0]}>
        <boxGeometry
          args={[gateWidth * 2 + gateSpacing + 0.78, 0.36, gateDepth + 0.12]}
        />
        <meshStandardMaterial
          ref={topBeamMaterialRef}
          color={FRAME_EDGE}
          emissive="#475569"
          emissiveIntensity={0.12}
          metalness={0.16}
          roughness={0.48}
        />
      </mesh>
    </group>
  );
}

export function PredictionGates3D() {
  const hydrate = useAppStore((state) => state.hydratePredictionMarkets);
  const markets = useAppStore((state) => state.predictionMarkets.markets);
  const [error, setError] = useState(false);
  const [buyEffects, setBuyEffects] = useState<
    Partial<Record<number, BuyEffect>>
  >({});
  const buyEffectTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const data = await fetchPredictionMarkets();
        if (!disposed) {
          hydrate(data);
          setError(false);
        }
      } catch {
        if (!disposed) {
          setError(true);
        }
      }
      if (!disposed) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [hydrate]);

  useEffect(() => {
    const onBuyIntent = (event: Event) => {
      const custom = event as CustomEvent<BuyIntentEventDetail>;
      const marketIndex = custom.detail?.marketIndex;
      const side = custom.detail?.side;
      if (
        typeof marketIndex !== "number" ||
        (side !== "yes" && side !== "no")
      ) {
        return;
      }
      const startedAtMs = Date.now();
      setBuyEffects((prev) => ({
        ...prev,
        [marketIndex]: { side, startedAtMs },
      }));
      const timeoutId = window.setTimeout(() => {
        setBuyEffects((prev) => {
          const existing = prev[marketIndex];
          if (!existing || existing.startedAtMs !== startedAtMs) {
            return prev;
          }
          const next = { ...prev };
          delete next[marketIndex];
          return next;
        });
      }, BUY_EFFECT_DURATION_MS);
      buyEffectTimeoutsRef.current.push(timeoutId);
    };

    window.addEventListener(BUY_INTENT_EVENT, onBuyIntent as EventListener);
    return () => {
      window.removeEventListener(BUY_INTENT_EVENT, onBuyIntent as EventListener);
      for (const timeoutId of buyEffectTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      buyEffectTimeoutsRef.current = [];
    };
  }, []);

  return (
    <group>
      {/* Plaza area label */}

      {PREDICTION_PLAZA.gatePositions.map((pos, index) => (
        <GatePair
          buyEffect={buyEffects[index]}
          key={index}
          market={markets[index]}
          position={pos}
          rotationY={PREDICTION_PLAZA.gateRotationY}
        />
      ))}
    </group>
  );
}
