import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial } from "three";

const BINANCE_MINI_TICKER_STREAM_URL =
  "wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker/bnbusdt@miniTicker/solusdt@miniTicker";
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const BOARD_ANCHOR: [number, number, number] = [0, 10, 60];
const BOARD_WIDTH = 36;
const BOARD_HEIGHT = 24;
const BOARD_BASE_ROTATION_Y = Math.PI;
const BOARD_TILT_X = -0.08;
const BOARD_TILT_Z = 0;

const TRACKED_COINS = [
  { symbol: "BTCUSDT", label: "BTC" },
  { symbol: "ETHUSDT", label: "ETH" },
  { symbol: "BNBUSDT", label: "BNB" },
  { symbol: "SOLUSDT", label: "SOL" },
] as const;

type TrackedSymbol = (typeof TRACKED_COINS)[number]["symbol"];
type SocketStatus = "connecting" | "live" | "reconnecting";

type CoinTicker = {
  changePercent: number;
  eventTime: number;
  price: number;
  symbol: TrackedSymbol;
};

type MiniTickerPayload = {
  E: number;
  c: string;
  o: string;
  s: string;
};

type CombinedMiniTickerMessage = {
  data?: MiniTickerPayload;
};

const EMPTY_TICKERS: Record<TrackedSymbol, CoinTicker | undefined> = {
  BTCUSDT: undefined,
  ETHUSDT: undefined,
  BNBUSDT: undefined,
  SOLUSDT: undefined,
};

function isTrackedSymbol(symbol: string): symbol is TrackedSymbol {
  return TRACKED_COINS.some((coin) => coin.symbol === symbol);
}

function parseMiniTickerMessage(raw: string): CoinTicker | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = payload as CombinedMiniTickerMessage;
  if (!message.data) {
    return null;
  }

  const symbol = message.data.s?.toUpperCase();
  if (!symbol || !isTrackedSymbol(symbol)) {
    return null;
  }

  const price = Number.parseFloat(message.data.c);
  const openPrice = Number.parseFloat(message.data.o);
  const eventTime = message.data.E;

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(openPrice) ||
    openPrice <= 0 ||
    !Number.isFinite(eventTime)
  ) {
    return null;
  }

  return {
    changePercent: ((price - openPrice) / openPrice) * 100,
    eventTime,
    price,
    symbol,
  };
}

function formatPrice(value: number): string {
  if (value >= 1_000) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (value >= 1) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getStatusText(status: SocketStatus): string {
  if (status === "live") {
    return "LIVE";
  }
  if (status === "reconnecting") {
    return "RECONNECT";
  }
  return "SYNCING";
}

function getStatusColor(status: SocketStatus): string {
  if (status === "live") {
    return "#4ade80";
  }
  if (status === "reconnecting") {
    return "#f59e0b";
  }
  return "#60a5fa";
}

function getChangeColor(value?: number): string {
  if (typeof value !== "number") {
    return "#93c5fd";
  }
  return value >= 0 ? "#4ade80" : "#fb7185";
}

export function LiveMarketBoard3D() {
  const boardRef = useRef<Group>(null);
  const chassisMaterialRef = useRef<MeshStandardMaterial>(null);
  const screenMaterialRef = useRef<MeshStandardMaterial>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [tickers, setTickers] =
    useState<Record<TrackedSymbol, CoinTicker | undefined>>(EMPTY_TICKERS);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let retryAttempt = 0;
    let socket: WebSocket | undefined;
    let isDisposed = false;

    const clearReconnectTimer = () => {
      if (typeof reconnectTimer !== "number") {
        return;
      }
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };

    const connect = () => {
      if (isDisposed) {
        return;
      }

      clearReconnectTimer();
      setStatus(retryAttempt === 0 ? "connecting" : "reconnecting");
      socket = new WebSocket(BINANCE_MINI_TICKER_STREAM_URL);

      socket.addEventListener("open", () => {
        retryAttempt = 0;
        setStatus("live");
      });

      socket.addEventListener("message", (event) => {
        const ticker = parseMiniTickerMessage(String(event.data));
        if (!ticker) {
          return;
        }

        setTickers((previous) => ({
          ...previous,
          [ticker.symbol]: ticker,
        }));
      });

      socket.addEventListener("error", () => {
        if (!isDisposed) {
          setStatus("reconnecting");
        }
      });

      socket.addEventListener("close", () => {
        if (isDisposed) {
          return;
        }

        setStatus("reconnecting");
        const waitMs = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** retryAttempt,
          MAX_RECONNECT_DELAY_MS,
        );
        retryAttempt += 1;
        reconnectTimer = window.setTimeout(connect, waitMs);
      });
    };

    connect();

    return () => {
      isDisposed = true;
      clearReconnectTimer();
      socket?.close();
    };
  }, []);

  const latestEventTime = useMemo(() => {
    return TRACKED_COINS.reduce<number | undefined>((latest, coin) => {
      const value = tickers[coin.symbol]?.eventTime;
      if (typeof value !== "number") {
        return latest;
      }
      if (typeof latest !== "number" || value > latest) {
        return value;
      }
      return latest;
    }, undefined);
  }, [tickers]);

  useFrame(({ clock }) => {
    if (!boardRef.current) {
      return;
    }

    const elapsed = clock.getElapsedTime();
    boardRef.current.position.set(BOARD_ANCHOR[0], BOARD_ANCHOR[1], BOARD_ANCHOR[2]);
    boardRef.current.rotation.set(
      BOARD_TILT_X,
      BOARD_BASE_ROTATION_Y,
      BOARD_TILT_Z,
    );

    if (chassisMaterialRef.current) {
      chassisMaterialRef.current.emissiveIntensity =
        0.1 + Math.sin(elapsed * 0.72) * 0.015;
    }

    if (screenMaterialRef.current) {
      screenMaterialRef.current.emissiveIntensity =
        0.21 + Math.sin(elapsed * 1.1) * 0.03;
    }
  });

  return (
    <group ref={boardRef} position={BOARD_ANCHOR}>
      <mesh castShadow receiveShadow position={[-13, -18, -3.2]}>
        <boxGeometry args={[2.2, 36, 2.2]} />
        <meshStandardMaterial
          color="#404953"
          emissive="#1a2028"
          emissiveIntensity={0.08}
          metalness={0.33}
          roughness={0.5}
        />
      </mesh>
      <mesh castShadow receiveShadow position={[13, -18, -3.2]}>
        <boxGeometry args={[2.2, 36, 2.2]} />
        <meshStandardMaterial
          color="#404953"
          emissive="#1a2028"
          emissiveIntensity={0.08}
          metalness={0.33}
          roughness={0.5}
        />
      </mesh>
      <mesh castShadow receiveShadow position={[-8.8, -8.4, -2.5]} rotation={[0.44, 0, 0]}>
        <boxGeometry args={[1.1, 18.6, 1.1]} />
        <meshStandardMaterial color="#52606d" metalness={0.35} roughness={0.42} />
      </mesh>
      <mesh castShadow receiveShadow position={[8.8, -8.4, -2.5]} rotation={[0.44, 0, 0]}>
        <boxGeometry args={[1.1, 18.6, 1.1]} />
        <meshStandardMaterial color="#52606d" metalness={0.35} roughness={0.42} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -1.8, -3.2]}>
        <boxGeometry args={[28, 1.8, 2.2]} />
        <meshStandardMaterial
          color="#46515d"
          emissive="#1a2028"
          emissiveIntensity={0.07}
          metalness={0.34}
          roughness={0.48}
        />
      </mesh>

      <group position={[0, 0, 0]}>
        <mesh castShadow receiveShadow position={[0, 0, -0.35]}>
          <boxGeometry args={[BOARD_WIDTH + 3.8, BOARD_HEIGHT + 4.2, 4.6]} />
          <meshStandardMaterial
            ref={chassisMaterialRef}
            color="#262e38"
            emissive="#111722"
            emissiveIntensity={0.1}
            metalness={0.38}
            roughness={0.38}
          />
        </mesh>

        <mesh castShadow receiveShadow position={[0, 0, 2.15]}>
          <boxGeometry args={[BOARD_WIDTH + 1.2, BOARD_HEIGHT + 1.2, 1.35]} />
          <meshStandardMaterial
            color="#3a4653"
            emissive="#19212c"
            emissiveIntensity={0.1}
            metalness={0.36}
            roughness={0.31}
          />
        </mesh>

        <mesh castShadow receiveShadow position={[0, 0, 2.92]}>
          <boxGeometry args={[BOARD_WIDTH - 2.2, BOARD_HEIGHT - 2.2, 0.62]} />
          <meshStandardMaterial
            ref={screenMaterialRef}
            color="#0b1118"
            emissive="#0f283d"
            emissiveIntensity={0.21}
            metalness={0.12}
            roughness={0.5}
          />
        </mesh>

        <mesh castShadow receiveShadow position={[0, 13.4, 1.65]} rotation={[-0.1, 0, 0]}>
          <boxGeometry args={[BOARD_WIDTH + 2.4, 1.3, 3.2]} />
          <meshStandardMaterial
            color="#4d5b6a"
            emissive="#212a36"
            emissiveIntensity={0.09}
            metalness={0.34}
            roughness={0.37}
          />
        </mesh>

        <mesh castShadow receiveShadow position={[20, 0, 1.35]}>
          <boxGeometry args={[1.8, BOARD_HEIGHT + 2.6, 3.2]} />
          <meshStandardMaterial
            color="#42505e"
            emissive="#1a2430"
            emissiveIntensity={0.09}
            metalness={0.38}
            roughness={0.34}
          />
        </mesh>
        <mesh castShadow receiveShadow position={[-20, 0, 1.35]}>
          <boxGeometry args={[1.8, BOARD_HEIGHT + 2.6, 3.2]} />
          <meshStandardMaterial
            color="#42505e"
            emissive="#1a2430"
            emissiveIntensity={0.09}
            metalness={0.38}
            roughness={0.34}
          />
        </mesh>

        <mesh castShadow receiveShadow position={[0, 0, -2.55]}>
          <boxGeometry args={[6.5, BOARD_HEIGHT + 0.8, 0.7]} />
          <meshStandardMaterial color="#171e27" metalness={0.34} roughness={0.56} />
        </mesh>

        <mesh castShadow receiveShadow position={[-12.6, 0, 0.95]}>
          <boxGeometry args={[0.5, BOARD_HEIGHT + 1.2, 4.6]} />
          <meshStandardMaterial color="#2f3945" metalness={0.4} roughness={0.38} />
        </mesh>
        <mesh castShadow receiveShadow position={[12.6, 0, 0.95]}>
          <boxGeometry args={[0.5, BOARD_HEIGHT + 1.2, 4.6]} />
          <meshStandardMaterial color="#2f3945" metalness={0.4} roughness={0.38} />
        </mesh>

        <mesh position={[17.9, 10.1, 2.95]}>
          <sphereGeometry args={[0.34, 16, 16]} />
          <meshStandardMaterial
            color={getStatusColor(status)}
            emissive={getStatusColor(status)}
            emissiveIntensity={0.5}
            metalness={0.12}
            roughness={0.4}
          />
        </mesh>

        <Text
          anchorX="left"
          anchorY="middle"
          color="#f5f3ec"
          fontSize={1.8}
          maxWidth={22}
          position={[-16.2, 10.0, 3.2]}
        >
          MARKET SIGNAL TOWER
        </Text>
        <Text
          anchorX="right"
          anchorY="middle"
          color={getStatusColor(status)}
          fontSize={1.05}
          position={[16.5, 10.0, 3.2]}
        >
          {getStatusText(status)}
        </Text>

        <Text
          anchorX="left"
          anchorY="middle"
          color="#93c5fd"
          fontSize={0.85}
          position={[6.4, 7.9, 3.2]}
        >
          PRICE
        </Text>
        <Text
          anchorX="right"
          anchorY="middle"
          color="#93c5fd"
          fontSize={0.85}
          position={[16.5, 7.9, 3.2]}
        >
          24H
        </Text>

        {TRACKED_COINS.map((coin, index) => {
          const y = 5.2 - index * 4.0;
          const ticker = tickers[coin.symbol];
          const priceText = ticker ? `$${formatPrice(ticker.price)}` : "LOADING";
          const changeText = ticker ? formatPercent(ticker.changePercent) : "--";

          return (
            <group key={coin.symbol}>
              <mesh castShadow receiveShadow position={[0, y, 2.98]}>
                <boxGeometry args={[32.2, 2.75, 0.85]} />
                <meshStandardMaterial
                  color="#111921"
                  emissive="#0f2434"
                  emissiveIntensity={0.17}
                  metalness={0.18}
                  roughness={0.42}
                />
              </mesh>
              <mesh castShadow receiveShadow position={[-16.15, y, 2.9]}>
                <boxGeometry args={[0.2, 2.72, 1.1]} />
                <meshStandardMaterial color="#34506a" emissive="#223a50" emissiveIntensity={0.16} />
              </mesh>
              <Text
                anchorX="left"
                anchorY="middle"
                color="#f8fafc"
                fontSize={1.8}
                position={[-15.25, y, 3.44]}
              >
                {coin.label}
              </Text>
              <Text
                anchorX="right"
                anchorY="middle"
                color="#f8fafc"
                fontSize={1.55}
                position={[8.9, y, 3.44]}
              >
                {priceText}
              </Text>
              <Text
                anchorX="right"
                anchorY="middle"
                color={getChangeColor(ticker?.changePercent)}
                fontSize={1.42}
                position={[16.5, y, 3.44]}
              >
                {changeText}
              </Text>
              {index < TRACKED_COINS.length - 1 ? (
                <mesh position={[0, y - 2.0, 3.06]}>
                <boxGeometry args={[31.2, 0.16, 0.24]} />
                <meshStandardMaterial
                  color="#2b3746"
                  emissive="#1d2732"
                  emissiveIntensity={0.14}
                  metalness={0.22}
                  roughness={0.44}
                />
              </mesh>
            ) : null}
          </group>
        );
        })}
      </group>
    </group>
  );
}
