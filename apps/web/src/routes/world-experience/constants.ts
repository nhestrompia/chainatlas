import { type AvatarId, type ChainSlug } from "@chainatlas/shared";
import { runtimeConfig } from "@/lib/config/runtime";
import char1Img1xUrl from "../../../../char-img/optimized/char1-1x.jpg?url";
import char1Img2xUrl from "../../../../char-img/optimized/char1-2x.jpg?url";
import char2Img1xUrl from "../../../../char-img/optimized/char2-1x.jpg?url";
import char2Img2xUrl from "../../../../char-img/optimized/char2-2x.jpg?url";
import char3Img1xUrl from "../../../../char-img/optimized/char3-1x.jpg?url";
import char3Img2xUrl from "../../../../char-img/optimized/char3-2x.jpg?url";
import char4Img1xUrl from "../../../../char-img/optimized/char4-1x.jpg?url";
import char4Img2xUrl from "../../../../char-img/optimized/char4-2x.jpg?url";

export const NATIVE_CHAIN_IDS: Record<ChainSlug, number> = {
  ethereum: runtimeConfig.chains.ethereum.chainId,
  base: runtimeConfig.chains.base.chainId,
};

export const ROOM_BY_CHAIN: Record<ChainSlug, "ethereum:main" | "base:main"> = {
  ethereum: "ethereum:main",
  base: "base:main",
};

export const SHOUT_MAX_CHARS = 80;
export const SHOUT_TTL_MS = 4_500;
export const SHOUT_COOLDOWN_MS = 3_000;

export type SupportedErc20Token = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  name: string;
};

export const CHARACTER_OPTIONS: Array<{
  id: AvatarId;
  label: string;
  description: string;
  imageUrl: string;
  imageSrcSet: string;
}> = [
  {
    id: "navigator",
    label: "Navigator",
    description: "Steady all-round explorer.",
    imageUrl: char1Img1xUrl,
    imageSrcSet: `${char1Img1xUrl} 1x, ${char1Img2xUrl} 2x`,
  },
  {
    id: "warden",
    label: "Warden",
    description: "Solid and grounded silhouette.",
    imageUrl: char2Img1xUrl,
    imageSrcSet: `${char2Img1xUrl} 1x, ${char2Img2xUrl} 2x`,
  },
  {
    id: "sprinter",
    label: "Sprinter",
    description: "Light frame tuned for movement.",
    imageUrl: char3Img1xUrl,
    imageSrcSet: `${char3Img1xUrl} 1x, ${char3Img2xUrl} 2x`,
  },
  {
    id: "mystic",
    label: "Mystic",
    description: "Arcane style with distinct shape.",
    imageUrl: char4Img1xUrl,
    imageSrcSet: `${char4Img1xUrl} 1x, ${char4Img2xUrl} 2x`,
  },
];
