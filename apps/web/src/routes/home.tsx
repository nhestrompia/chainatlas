import { Link } from "@tanstack/react-router";

export function HomeRoute() {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[#08161e]" />
      <section className="w-full max-w-xl rounded-3xl border border-cyan-100/20 bg-[#101d25]/92 p-6 text-center shadow-xl">
        <p className="text-xs font-medium uppercase text-cyan-100/70">
          ChainAtlas Islands
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-balance">
          Cross-chain multiplayer world
        </h1>
        <p className="mt-2 text-sm text-cyan-100/75 text-pretty">
          Enter the world to connect your wallet and join the live Ethereum/Base
          islands.
        </p>
      </section>
      <section className="grid w-full max-w-5xl gap-4 md:grid-cols-3">
        {[
          [
            "Ethereum + Base islands",
            "Walk around the world and interact with onchain assets.",
          ],
          ["Bridge in-world", "Walk on the bridge to switch chains"],
          ["Multiplayer", "Socialize and interact with other players onchain."],
        ].map(([title, copy]) => (
          <article
            key={title}
            className="rounded-3xl border border-cyan-100/20 bg-[#101d25]/92 p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-balance">{title}</h2>
            <p className="mt-2 text-sm text-cyan-100/70 text-pretty">{copy}</p>
          </article>
        ))}
      </section>
      <Link
        className="rounded-full border border-cyan-100/30 bg-cyan-50/15 px-5 py-3 font-medium text-cyan-50 hover:border-cyan-100/45 hover:bg-cyan-50/20"
        to="/world"
      >
        Enter ChainAtlas
      </Link>
    </main>
  );
}
