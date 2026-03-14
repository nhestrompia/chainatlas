import { type AvatarId, type ChainSlug } from "@chainatlas/shared";
import { runtimeConfig } from "@/lib/config/runtime";
import { CHARACTER_OPTIONS } from "./constants";

function CharacterPreview({
  imageUrl,
  imageSrcSet,
  label,
}: {
  imageUrl: string;
  imageSrcSet: string;
  label: string;
}) {
  return (
    <div className="h-16 w-14 overflow-hidden rounded-xl border border-cyan-100/25 bg-black/30">
      <img
        alt={`${label} avatar`}
        className="h-full w-full object-cover"
        decoding="async"
        loading="lazy"
        sizes="56px"
        src={imageUrl}
        srcSet={imageSrcSet}
      />
    </div>
  );
}

export function CharacterSelectOverlay({
  onSelect,
}: {
  onSelect(avatarId: AvatarId): void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/88 px-4">
      <div className="w-full max-w-3xl rounded-3xl border border-cyan-100/20 bg-[#101d25]/95 p-6 shadow-2xl">
        <p className="text-xs uppercase text-cyan-100/70">Choose Character</p>
        <h2 className="mt-2 text-2xl font-semibold text-cyan-50">
          Pick your avatar before entering
        </h2>
        <p className="mt-2 text-sm text-cyan-100/75">
          Your choice is saved per wallet and used for multiplayer presence.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {CHARACTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="flex items-center gap-4 rounded-2xl border border-cyan-100/20 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15"
              onClick={() => onSelect(option.id)}
              type="button"
            >
              <CharacterPreview
                imageUrl={option.imageUrl}
                imageSrcSet={option.imageSrcSet}
                label={option.label}
              />
              <div>
                <p className="font-semibold text-cyan-50">{option.label}</p>
                <p className="mt-1 text-xs text-cyan-100/75">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChainSelectionOverlay({
  chainId,
  error,
  pendingChain,
  onSelect,
}: {
  chainId?: number;
  error?: string;
  pendingChain?: ChainSlug;
  onSelect(chain: ChainSlug): void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08161e]/90 px-4">
      <div className="w-full max-w-xl rounded-3xl border border-cyan-100/20 bg-[#101d25]/95 p-6 shadow-2xl">
        <p className="text-xs uppercase text-cyan-100/70">Select Chain</p>
        <h2 className="mt-2 text-2xl font-semibold text-cyan-50">
          Choose a supported world chain
        </h2>
        <p className="mt-2 text-sm text-cyan-100/75">
          {typeof chainId === "number"
            ? `Your wallet is on unsupported chain ID ${chainId}.`
            : "We could not confirm your wallet network."}{" "}
          Switch to Ethereum or Base to enter.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-2xl border border-cyan-100/25 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(pendingChain)}
            onClick={() => onSelect("ethereum")}
            type="button"
          >
            <p className="font-semibold text-cyan-50">Ethereum Island</p>
            <p className="mt-1 text-xs text-cyan-100/75">
              {runtimeConfig.chains.ethereum.label}
            </p>
          </button>
          <button
            className="rounded-2xl border border-cyan-100/25 bg-cyan-50/8 px-4 py-3 text-left transition-colors hover:border-cyan-100/40 hover:bg-cyan-50/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(pendingChain)}
            onClick={() => onSelect("base")}
            type="button"
          >
            <p className="font-semibold text-cyan-50">Base Island</p>
            <p className="mt-1 text-xs text-cyan-100/75">
              {runtimeConfig.chains.base.label}
            </p>
          </button>
        </div>
        {pendingChain ? (
          <p className="mt-4 text-sm text-cyan-100/80">
            Switching wallet to{" "}
            {pendingChain === "ethereum"
              ? runtimeConfig.chains.ethereum.label
              : runtimeConfig.chains.base.label}
            ...
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200/35 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
