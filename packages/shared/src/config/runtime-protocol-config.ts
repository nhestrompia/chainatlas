import type {
  ChainSlug,
  ProtocolRegistryEntry,
  ProtocolTokenSupport,
  RuntimeProfile,
  RuntimeProtocolConfig,
  SwapRouteConfig,
} from "../types/domain";

const ADDRESSES = {
  mainnet: {
    uniswapRouter: {
      ethereum: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      base: "0x2626664c2603336E57B271c5C0b26F421741e481",
    },
    aerodromeRouter: {
      base: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    },
    aerodromeFactory: {
      base: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    },
    acrossSpokePool: {
      ethereum: "0xFBc81a18EcDa8E6A91275cFDF5FC6d91A7C5AE80",
      base: "0x6C99671B249af73B2847D92123d823Cb3875E399",
    },
    wrappedNative: {
      ethereum: "0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2",
      base: "0x4200000000000000000000000000000000000006",
    },
    usdc: {
      ethereum: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      base: "0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913",
    },
    usdt: {
      ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    },
  },
  testnet: {
    uniswapRouter: {
      ethereum: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      base: "0x2626664c2603336E57B271c5C0b26F421741e481",
    },
    aerodromeRouter: {
      base: undefined,
    },
    aerodromeFactory: {
      base: undefined,
    },
    acrossSpokePool: {
      ethereum: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662",
      base: "0x82B564983aE7274c86695917BBf8C99ECb6F0F8F",
    },
    wrappedNative: {
      ethereum: "0xfff9976782d46CC05630D1f6eBAb18b2324d6B14",
      base: "0x4200000000000000000000000000000000000006",
    },
    usdc: {
      ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      base: "0x036CbD53842c5426634e7929541eC2318f3dCF7",
    },
    usdt: {
      ethereum: undefined,
      base: undefined,
    },
  },
} as const;

const CHAIN_IDS: Record<RuntimeProfile, Record<ChainSlug, number>> = {
  mainnet: {
    ethereum: 1,
    base: 8453,
  },
  testnet: {
    ethereum: 11155111,
    base: 84532,
  },
};

const DEFAULT_PROFILE: RuntimeProfile = "mainnet";
const INTEGRATOR_ID_ENV_KEY = "VITE_ACROSS_INTEGRATOR_ID";

function isAddressLike(value: string | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getSupportedTokens(profile: RuntimeProfile): ProtocolTokenSupport[] {
  const supported: ProtocolTokenSupport[] = [
    { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
    { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
    {
      chain: "ethereum",
      address: ADDRESSES[profile].usdc.ethereum,
      symbol: "USDC",
      decimals: 6,
    },
    {
      chain: "base",
      address: ADDRESSES[profile].usdc.base,
      symbol: "USDC",
      decimals: 6,
    },
  ];

  const ethereumUsdt = ADDRESSES[profile].usdt.ethereum;
  const baseUsdt = ADDRESSES[profile].usdt.base;
  if (isAddressLike(ethereumUsdt)) {
    supported.push({
      chain: "ethereum",
      address: ethereumUsdt,
      symbol: "USDT",
      decimals: 6,
    });
  }
  if (isAddressLike(baseUsdt)) {
    supported.push({
      chain: "base",
      address: baseUsdt,
      symbol: "USDT",
      decimals: 6,
    });
  }

  return supported;
}

function getSwapRoutes(profile: RuntimeProfile): SwapRouteConfig[] {
  const routes: SwapRouteConfig[] = [
    {
      routeId: "swap-eth-usdc-ethereum",
      label: "ETH -> USDC (Ethereum)",
      chain: "ethereum",
      dex: "uniswap_v3",
      enabled: true,
      routerAddress: ADDRESSES[profile].uniswapRouter.ethereum,
      tokenIn: ADDRESSES[profile].wrappedNative.ethereum,
      tokenOut: ADDRESSES[profile].usdc.ethereum,
      feeTier: 500,
      supportsNativeIn: true,
      inputTokenDecimals: 18,
      outputTokenDecimals: 6,
      defaultSlippageBps: 100,
    },
  ];

  if (profile === "mainnet") {
    const aerodromeRouter = ADDRESSES.mainnet.aerodromeRouter.base;
    const aerodromeFactory = ADDRESSES.mainnet.aerodromeFactory.base;
    routes.push({
      routeId: "swap-eth-usdc-base",
      label: "ETH -> USDC (Base)",
      chain: "base",
      dex: "aerodrome",
      enabled: true,
      routerAddress: aerodromeRouter,
      tokenIn: ADDRESSES.mainnet.wrappedNative.base,
      tokenOut: ADDRESSES.mainnet.usdc.base,
      supportsNativeIn: true,
      aerodromeStable: false,
      aerodromeFactory,
      inputTokenDecimals: 18,
      outputTokenDecimals: 6,
      defaultSlippageBps: 100,
    });
    routes.push({
      routeId: "swap-usdc-usdt-base",
      label: "USDC -> USDT (Base)",
      chain: "base",
      dex: "aerodrome",
      enabled: true,
      routerAddress: aerodromeRouter,
      tokenIn: ADDRESSES.mainnet.usdc.base,
      tokenOut: ADDRESSES.mainnet.usdt.base,
      supportsNativeIn: false,
      aerodromeStable: true,
      aerodromeFactory,
      inputTokenDecimals: 6,
      outputTokenDecimals: 6,
      defaultSlippageBps: 50,
    });
    routes.push({
      routeId: "swap-usdc-usdt-ethereum",
      label: "USDC -> USDT (Ethereum)",
      chain: "ethereum",
      dex: "uniswap_v3",
      enabled: true,
      routerAddress: ADDRESSES.mainnet.uniswapRouter.ethereum,
      tokenIn: ADDRESSES.mainnet.usdc.ethereum,
      tokenOut: ADDRESSES.mainnet.usdt.ethereum,
      feeTier: 100,
      supportsNativeIn: false,
      inputTokenDecimals: 6,
      outputTokenDecimals: 6,
      defaultSlippageBps: 50,
    });
  } else {
    routes.push({
      routeId: "swap-eth-usdc-base",
      label: "ETH -> USDC (Base)",
      chain: "base",
      dex: "uniswap_v3",
      enabled: true,
      routerAddress: ADDRESSES[profile].uniswapRouter.base,
      tokenIn: ADDRESSES[profile].wrappedNative.base,
      tokenOut: ADDRESSES[profile].usdc.base,
      feeTier: 500,
      supportsNativeIn: true,
      inputTokenDecimals: 18,
      outputTokenDecimals: 6,
      defaultSlippageBps: 100,
    });
  }

  return routes;
}

function getProtocolRegistry(
  profile: RuntimeProfile,
  swapRoutes: SwapRouteConfig[],
): ProtocolRegistryEntry[] {
  const supportedTokens = getSupportedTokens(profile);

  return [
    {
      id: "send",
      kind: "send",
      profile,
      label: "Courier",
      chainSupport: ["ethereum", "base"],
      supportedTokens,
      execution: {
        type: "send.native_erc20",
      },
      contractAddresses: {},
    },
    {
      id: "swap-uniswap-v3",
      kind: "swap",
      profile,
      label: "Swap Hall",
      chainSupport: ["ethereum", "base"],
      supportedTokens,
      execution: {
        type: "swap.uniswap_v3",
        routeIds: swapRoutes.map((route) => route.routeId),
      },
      swapRoutes,
      contractAddresses: {
        ethereum: ADDRESSES[profile].uniswapRouter.ethereum,
        base:
          profile === "mainnet"
            ? (ADDRESSES[profile].aerodromeRouter.base ?? ADDRESSES[profile].uniswapRouter.base)
            : ADDRESSES[profile].uniswapRouter.base,
      },
    },
    {
      id: "bridge-across",
      kind: "bridge",
      profile,
      label: "Bridge",
      chainSupport: ["ethereum", "base"],
      supportedTokens: [
        { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
        { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
        {
          chain: "ethereum",
          address: ADDRESSES[profile].usdc.ethereum,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "base",
          address: ADDRESSES[profile].usdc.base,
          symbol: "USDC",
          decimals: 6,
        },
      ],
      execution: {
        type: "bridge.across",
        bridgeApiBaseUrl:
          profile === "testnet"
            ? "https://testnet.across.to/api"
            : "https://app.across.to/api",
      },
      contractAddresses: {
        ethereum: ADDRESSES[profile].acrossSpokePool.ethereum,
        base: ADDRESSES[profile].acrossSpokePool.base,
      },
    },
  ];
}

export function resolveRuntimeProfile(profile?: string): RuntimeProfile {
  if (profile === "mainnet" || profile === "testnet") {
    return profile;
  }
  return DEFAULT_PROFILE;
}

export function getRuntimeProtocolConfig(
  profileInput?: string,
): RuntimeProtocolConfig {
  const profile = resolveRuntimeProfile(profileInput);
  const swapRoutes = getSwapRoutes(profile);

  return {
    profile,
    chains: {
      ethereum: {
        slug: "ethereum",
        chainId: CHAIN_IDS[profile].ethereum,
        label: profile === "testnet" ? "Sepolia" : "Ethereum",
        wrappedNativeAddress: ADDRESSES[profile].wrappedNative.ethereum,
      },
      base: {
        slug: "base",
        chainId: CHAIN_IDS[profile].base,
        label: profile === "testnet" ? "Base Sepolia" : "Base",
        wrappedNativeAddress: ADDRESSES[profile].wrappedNative.base,
      },
    },
    swapRoutes,
    bridge: {
      protocol: "across",
      apiBaseUrl:
        profile === "testnet"
          ? "https://testnet.across.to/api"
          : "https://app.across.to/api",
      integratorIdEnvKey: INTEGRATOR_ID_ENV_KEY,
      spokePoolAddresses: {
        ethereum: ADDRESSES[profile].acrossSpokePool.ethereum,
        base: ADDRESSES[profile].acrossSpokePool.base,
      },
      supportedAssets: [
        { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
        { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
        {
          chain: "ethereum",
          address: ADDRESSES[profile].usdc.ethereum,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "base",
          address: ADDRESSES[profile].usdc.base,
          symbol: "USDC",
          decimals: 6,
        },
      ],
    },
    protocolRegistry: getProtocolRegistry(profile, swapRoutes),
  };
}
