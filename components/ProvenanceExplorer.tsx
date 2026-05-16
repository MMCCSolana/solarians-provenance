"use client";

import { useEffect, useState } from "react";
import PairTable from "@/components/PairTable";
import type { ProvenanceData, ProvenanceRecord } from "@/lib/types";

export default function ProvenanceExplorer() {
  const [data, setData] = useState<ProvenanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const response = await fetch("/data/pairs.json");

        if (!response.ok) {
          throw new Error(`Failed to load provenance data (${response.status})`);
        }

        const parsed = normalizeProvenanceData(await response.json());

        if (!cancelled) {
          setData(parsed);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load provenance data");
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = data ? getStats(data) : null;

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-glow backdrop-blur md:p-7">
        <div className="mb-4 inline-flex rounded-full border border-solana-purple/40 bg-solana-purple/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-solana-green">
          Solarians provenance
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] xl:items-start">
          <div>
            <h1 className="max-w-3xl text-3xl font-black leading-[1.05] tracking-tight text-white md:text-5xl">
              The On-Chain History of Solarians
            </h1>
            <p className="mt-3 max-w-2xl text-lg font-semibold leading-7 text-solana-green md:text-xl">
              From 9-decimal FT mints to the modern NFT collection.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
              This explorer separates the early FT era, the later direct NFT mints, and the Token
              Entangler records that bridge the two.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] xl:grid-cols-1">
              <div className="space-y-3 text-sm leading-6 text-slate-300">
                <p>
                Solarians first minted in April of 2021 as 9-decimal FTs while Metaplex was still in
                its infancy. The project later transitioned the website mint to true NFT-standard
                mints in August of 2021.
                </p>
                <p>
                Then in February of 2022, the team launched the Token Entangler to bring those original
                FTs into the modern NFT era, letting holders swap their original FT mint for a modern
                NFT.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Original FT tokens" value={stats?.originalFtTokens} />
                <Stat label="Original NFT mints" value={stats?.originalNftMints} />
                <Stat label="Entangled NFT mints" value={stats?.entangledNftMints} />
                <Stat label="NFTs exchanged" value={stats?.exchanged} />
                <Stat label="Awaiting exchange" value={stats?.awaitingExchange} />
              </div>
            </div>
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6 text-sm text-amber-100">
          {error}
        </div>
      ) : data ? (
        <PairTable data={data} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-10 text-center text-sm text-slate-300">
          Loading provenance data...
        </div>
      )}
    </section>
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

function getStats(data: ProvenanceData) {
  const entangledNftMints = data.nfts.filter((record) => record.entangledPairAddress).length;
  const originalNftMints = data.nfts.length - entangledNftMints;
  const exchanged = data.nfts.filter((record) => record.entangledPairAddress && record.swapped).length;

  return {
    originalFtTokens: data.originalTokens.length,
    originalNftMints,
    entangledNftMints,
    exchanged,
    awaitingExchange: entangledNftMints - exchanged
  };
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-xl font-bold text-white md:text-2xl">{typeof value === "number" ? value.toLocaleString() : "..."}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    </div>
  );
}
