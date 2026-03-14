import {
  getRuntimeProtocolConfig,
  resolveRuntimeProfile,
  type ChainSlug,
  type RuntimeProtocolConfig,
} from "@chainatlas/shared";
import { env } from "@/lib/config/env";

export const runtimeProfile = resolveRuntimeProfile(env.profile);
export const runtimeConfig: RuntimeProtocolConfig = getRuntimeProtocolConfig(
  runtimeProfile,
  env.protocolAddressOverrides,
);

export function getChainIdForSlug(slug: ChainSlug) {
  return runtimeConfig.chains[slug].chainId;
}
