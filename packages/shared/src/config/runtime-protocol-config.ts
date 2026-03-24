import type {
  ChainSlug,
  ProtocolRegistryEntry,
  ProtocolTokenSupport,
  RuntimeProfile,
  RuntimeProtocolConfig,
  SwapRouteConfig,
} from "../types/domain";

export type RuntimeAddressOverrides = Partial<{
  uniswapRouterEthereum: string;
  uniswapRouterBase: string;
  aerodromeRouterBase: string;
  aerodromeFactoryBase: string;
  acrossSpokePoolEthereum: string;
  acrossSpokePoolBase: string;
  acrossSpokePoolPolygon: string;
  wrappedNativeEthereum: string;
  wrappedNativeBase: string;
  wrappedNativePolygon: string;
  usdcEthereum: string;
  usdcBase: string;
  usdcPolygon: string;
  usdtEthereum: string;
  usdtBase: string;
}>;

type RuntimeAddresses = {
  uniswapRouter: {
    ethereum: string;
    base: string;
  };
  aerodromeRouter: {
    base?: string;
  };
  aerodromeFactory: {
    base?: string;
  };
  acrossSpokePool: {
    ethereum: string;
    base: string;
    polygon: string;
  };
  wrappedNative: {
    ethereum: string;
    base: string;
    polygon: string;
  };
  usdc: {
    ethereum: string;
    base: string;
    polygon: string;
  };
  usdt: {
    ethereum?: string;
    base?: string;
  };
};

const DEFAULT_ADDRESSES: Record<RuntimeProfile, RuntimeAddresses> = {
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
      ethereum: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
      base: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      polygon: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    },
    wrappedNative: {
      ethereum: "0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2",
      base: "0x4200000000000000000000000000000000000006",
      polygon: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    },
    usdc: {
      ethereum: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      base: "0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913",
      polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
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
      polygon: "0xd08baaE74D6d2eAb1F3320B2E1a53eeb391ce8e5",
    },
    wrappedNative: {
      ethereum: "0xfff9976782d46CC05630D1f6eBAb18b2324d6B14",
      base: "0x4200000000000000000000000000000000000006",
      polygon: "0x52eF3d68BaB452a294342DC3e5f464d7f610f72E",
    },
    usdc: {
      ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      polygon: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    },
    usdt: {
      ethereum: undefined,
      base: undefined,
    },
  },
};

const CHAIN_IDS: Record<RuntimeProfile, Record<ChainSlug, number>> = {
  mainnet: {
    ethereum: 1,
    base: 8453,
    polygon: 137,
  },
  testnet: {
    ethereum: 11155111,
    base: 84532,
    polygon: 80002,
  },
};

const DEFAULT_PROFILE: RuntimeProfile = "testnet";
const INTEGRATOR_ID_ENV_KEY = "VITE_ACROSS_INTEGRATOR_ID";
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isAddressLike(value: string | undefined): value is string {
  return typeof value === "string" && ADDRESS_REGEX.test(value);
}

function resolveRequiredAddress(
  override: string | undefined,
  fallback: string,
  fieldLabel: string,
) {
  const value = (override ?? fallback).trim();
  if (!isAddressLike(value)) {
    throw new Error(`Invalid address for ${fieldLabel}: ${value || "(empty)"}`);
  }
  return value.toLowerCase();
}

function resolveOptionalAddress(
  override: string | undefined,
  fallback: string | undefined,
  fieldLabel: string,
) {
  const source = override ?? fallback;
  if (!source) {
    return undefined;
  }
  const value = source.trim();
  if (!value) {
    return undefined;
  }
  if (!isAddressLike(value)) {
    throw new Error(`Invalid address for ${fieldLabel}: ${value}`);
  }
  return value.toLowerCase();
}

function resolveRuntimeAddresses(
  profile: RuntimeProfile,
  overrides: RuntimeAddressOverrides,
): RuntimeAddresses {
  const defaults = DEFAULT_ADDRESSES[profile];

  return {
    uniswapRouter: {
      ethereum: resolveRequiredAddress(
        overrides.uniswapRouterEthereum,
        defaults.uniswapRouter.ethereum,
        `${profile}.uniswapRouter.ethereum`,
      ),
      base: resolveRequiredAddress(
        overrides.uniswapRouterBase,
        defaults.uniswapRouter.base,
        `${profile}.uniswapRouter.base`,
      ),
    },
    aerodromeRouter: {
      base: resolveOptionalAddress(
        overrides.aerodromeRouterBase,
        defaults.aerodromeRouter.base,
        `${profile}.aerodromeRouter.base`,
      ),
    },
    aerodromeFactory: {
      base: resolveOptionalAddress(
        overrides.aerodromeFactoryBase,
        defaults.aerodromeFactory.base,
        `${profile}.aerodromeFactory.base`,
      ),
    },
    acrossSpokePool: {
      ethereum: resolveRequiredAddress(
        overrides.acrossSpokePoolEthereum,
        defaults.acrossSpokePool.ethereum,
        `${profile}.acrossSpokePool.ethereum`,
      ),
      base: resolveRequiredAddress(
        overrides.acrossSpokePoolBase,
        defaults.acrossSpokePool.base,
        `${profile}.acrossSpokePool.base`,
      ),
      polygon: resolveRequiredAddress(
        overrides.acrossSpokePoolPolygon,
        defaults.acrossSpokePool.polygon,
        `${profile}.acrossSpokePool.polygon`,
      ),
    },
    wrappedNative: {
      ethereum: resolveRequiredAddress(
        overrides.wrappedNativeEthereum,
        defaults.wrappedNative.ethereum,
        `${profile}.wrappedNative.ethereum`,
      ),
      base: resolveRequiredAddress(
        overrides.wrappedNativeBase,
        defaults.wrappedNative.base,
        `${profile}.wrappedNative.base`,
      ),
      polygon: resolveRequiredAddress(
        overrides.wrappedNativePolygon,
        defaults.wrappedNative.polygon,
        `${profile}.wrappedNative.polygon`,
      ),
    },
    usdc: {
      ethereum: resolveRequiredAddress(
        overrides.usdcEthereum,
        defaults.usdc.ethereum,
        `${profile}.usdc.ethereum`,
      ),
      base: resolveRequiredAddress(
        overrides.usdcBase,
        defaults.usdc.base,
        `${profile}.usdc.base`,
      ),
      polygon: resolveRequiredAddress(
        overrides.usdcPolygon,
        defaults.usdc.polygon,
        `${profile}.usdc.polygon`,
      ),
    },
    usdt: {
      ethereum: resolveOptionalAddress(
        overrides.usdtEthereum,
        defaults.usdt.ethereum,
        `${profile}.usdt.ethereum`,
      ),
      base: resolveOptionalAddress(
        overrides.usdtBase,
        defaults.usdt.base,
        `${profile}.usdt.base`,
      ),
    },
  };
}

function getSupportedTokens(
  addresses: RuntimeAddresses,
): ProtocolTokenSupport[] {
  const supported: ProtocolTokenSupport[] = [
    { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
    { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
    {
      chain: "ethereum",
      address: addresses.usdc.ethereum,
      symbol: "USDC",
      decimals: 6,
    },
    {
      chain: "base",
      address: addresses.usdc.base,
      symbol: "USDC",
      decimals: 6,
    },
  ];

  const ethereumUsdt = addresses.usdt.ethereum;
  const baseUsdt = addresses.usdt.base;
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

function getSwapRoutes(
  profile: RuntimeProfile,
  addresses: RuntimeAddresses,
): SwapRouteConfig[] {
  const routes: SwapRouteConfig[] = [
    {
      routeId: "swap-eth-usdc-ethereum",
      label: "ETH -> USDC (Ethereum)",
      chain: "ethereum",
      dex: "uniswap_v3",
      enabled: true,
      routerAddress: addresses.uniswapRouter.ethereum,
      tokenIn: addresses.wrappedNative.ethereum,
      tokenOut: addresses.usdc.ethereum,
      feeTier: 500,
      supportsNativeIn: true,
      inputTokenDecimals: 18,
      outputTokenDecimals: 6,
      defaultSlippageBps: 100,
    },
  ];

  if (profile === "mainnet") {
    const aerodromeRouter = addresses.aerodromeRouter.base;
    const aerodromeFactory = addresses.aerodromeFactory.base;
    const baseUsdt = addresses.usdt.base;
    const ethereumUsdt = addresses.usdt.ethereum;
    if (!aerodromeRouter) {
      throw new Error(
        "Mainnet swap config is missing aerodrome router address",
      );
    }
    if (!aerodromeFactory) {
      throw new Error(
        "Mainnet swap config is missing aerodrome factory address",
      );
    }
    if (!baseUsdt || !ethereumUsdt) {
      throw new Error("Mainnet swap config is missing USDT token addresses");
    }
    routes.push({
      routeId: "swap-eth-usdc-base",
      label: "ETH -> USDC (Base)",
      chain: "base",
      dex: "aerodrome",
      enabled: true,
      routerAddress: aerodromeRouter,
      tokenIn: addresses.wrappedNative.base,
      tokenOut: addresses.usdc.base,
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
      tokenIn: addresses.usdc.base,
      tokenOut: baseUsdt,
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
      routerAddress: addresses.uniswapRouter.ethereum,
      tokenIn: addresses.usdc.ethereum,
      tokenOut: ethereumUsdt,
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
      routerAddress: addresses.uniswapRouter.base,
      tokenIn: addresses.wrappedNative.base,
      tokenOut: addresses.usdc.base,
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
  addresses: RuntimeAddresses,
): ProtocolRegistryEntry[] {
  const supportedTokens = getSupportedTokens(addresses);

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
        ethereum: addresses.uniswapRouter.ethereum,
        base:
          profile === "mainnet"
            ? (addresses.aerodromeRouter.base ?? addresses.uniswapRouter.base)
            : addresses.uniswapRouter.base,
      },
    },
    {
      id: "bridge-across",
      kind: "bridge",
      profile,
      label: "Bridge",
      chainSupport: ["ethereum", "base", "polygon"],
      supportedTokens: [
        { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
        { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
        {
          chain: "ethereum",
          address: addresses.usdc.ethereum,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "base",
          address: addresses.usdc.base,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "polygon",
          address: addresses.wrappedNative.polygon,
          symbol: "ETH",
          decimals: 18,
        },
        {
          chain: "polygon",
          address: addresses.usdc.polygon,
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
        ethereum: addresses.acrossSpokePool.ethereum,
        base: addresses.acrossSpokePool.base,
        polygon: addresses.acrossSpokePool.polygon,
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
  addressOverrides: RuntimeAddressOverrides = {},
): RuntimeProtocolConfig {
  const profile = resolveRuntimeProfile(profileInput);
  const addresses = resolveRuntimeAddresses(profile, addressOverrides);
  const swapRoutes = getSwapRoutes(profile, addresses);

  return {
    profile,
    chains: {
      ethereum: {
        slug: "ethereum",
        chainId: CHAIN_IDS[profile].ethereum,
        label: profile === "testnet" ? "Sepolia" : "Ethereum",
        wrappedNativeAddress: addresses.wrappedNative.ethereum,
      },
      base: {
        slug: "base",
        chainId: CHAIN_IDS[profile].base,
        label: profile === "testnet" ? "Base Sepolia" : "Base",
        wrappedNativeAddress: addresses.wrappedNative.base,
      },
      polygon: {
        slug: "polygon",
        chainId: CHAIN_IDS[profile].polygon,
        label: profile === "testnet" ? "Amoy" : "Polygon",
        wrappedNativeAddress: addresses.wrappedNative.polygon,
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
        ethereum: addresses.acrossSpokePool.ethereum,
        base: addresses.acrossSpokePool.base,
        polygon: addresses.acrossSpokePool.polygon,
      },
      supportedAssets: [
        { chain: "ethereum", address: "native", symbol: "ETH", decimals: 18 },
        { chain: "base", address: "native", symbol: "ETH", decimals: 18 },
        {
          chain: "ethereum",
          address: addresses.usdc.ethereum,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "base",
          address: addresses.usdc.base,
          symbol: "USDC",
          decimals: 6,
        },
        {
          chain: "polygon",
          address: addresses.wrappedNative.polygon,
          symbol: "ETH",
          decimals: 18,
        },
        {
          chain: "polygon",
          address: addresses.usdc.polygon,
          symbol: "USDC",
          decimals: 6,
        },
      ],
    },
    protocolRegistry: getProtocolRegistry(profile, swapRoutes, addresses),
  };
}
