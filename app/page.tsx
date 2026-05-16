import PairTable from "@/components/PairTable";
import pairs from "@/data/pairs.json";
import type { ProvenanceData, ProvenanceRecord } from "@/lib/types";

export default function Home() {
  const data = normalizeProvenanceData(pairs);
  const nftEntangledCount = data.nfts.filter((record) => record.entangledPairAddress).length;
  const nftUnentangledCount = data.nfts.length - nftEntangledCount;
  const exchangedCount = data.nfts.filter((record) => record.entangledPairAddress && record.swapped).length;
  const awaitingExchangeCount = nftEntangledCount - exchangedCount;

  return (
    <main className="min-h-screen px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-glow backdrop-blur md:p-8">
          <div className="mb-4 inline-flex rounded-full border border-solana-purple/40 bg-solana-purple/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-solana-green">
            Solarians provenance
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="max-w-4xl text-4xl font-black tracking-tight text-white md:text-6xl">
                Solarians from FT mint to NFT collection.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
                This explorer separates the early 9-decimal FT mints, the later direct NFT mints, and
                the Token Entangler records that bridge the two eras.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[34rem]">
              <Stat label="Original FT tokens" value={data.originalTokens.length} />
              <Stat label="Original NFT mints" value={nftUnentangledCount} />
              <Stat label="Entangled NFT mints" value={nftEntangledCount} />
              <Stat label="NFTs exchanged" value={exchangedCount} />
              <Stat label="Awaiting exchange" value={awaitingExchangeCount} />
            </div>
          </div>
        </header>

        <PairTable data={data} />
      </section>
    </main>
  );
}

function normalizeProvenanceData(value: unknown): ProvenanceData {
  if (Array.isArray(value)) {
    const originalTokens = value as ProvenanceRecord[];
    return {
      originalTokens,
      nfts: originalTokens.flatMap((record) =>
        record.pairs.map((pair) => ({
          tokenB: pair.tokenB,
          tokenA: record.tokenA,
          entangledPairAddress: pair.entangledPairAddress,
          swapped: pair.swapped
        }))
      )
    };
  }

  return value as ProvenanceData;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    </div>
  );
}
