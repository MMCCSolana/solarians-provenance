"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import PairTable from "@/components/PairTable";
import {
  BUCKET_CONFIG_BY_ID,
  getBucketData,
  isExplorerBucket,
  normalizeProvenanceData,
  tokenBsForOriginalRecord,
  type ExplorerBucket
} from "@/lib/provenance";
import type { NftRecord, OriginalTokenRecord, ProvenanceData, TokenB } from "@/lib/types";

type TraitFilter = {
  key: string;
  value: string;
};

type TraitOption = TraitFilter & {
  count: number;
  percent: number;
};

type TraitGroup = {
  key: string;
  options: TraitOption[];
  total: number;
};

type BucketAsset =
  | {
      kind: "original-ft";
      record: OriginalTokenRecord;
      tokenBs: TokenB[];
    }
  | {
      kind: "nft";
      record: NftRecord;
      tokenBs: TokenB[];
    };

const EXCLUDED_TRAIT_KEYS = new Set(["Mint #", "Ranking #"]);

export default function BucketExplorer({ bucket }: { bucket: string }) {
  const validBucket = isExplorerBucket(bucket);
  const activeBucket: ExplorerBucket = validBucket ? bucket : "original-ft";
  const [data, setData] = useState<ProvenanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

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

  const selectedTraits = useMemo(() => decodeTraitFilters(searchParams.getAll("trait")), [searchParams]);
  const config = BUCKET_CONFIG_BY_ID[activeBucket];
  const bucketData = data ? getBucketData(data, activeBucket) : null;
  const baseAssets = useMemo(
    () => (bucketData ? bucketAssets(activeBucket, bucketData.originalTokens, bucketData.nfts) : []),
    [activeBucket, bucketData]
  );
  const traitGroups = useMemo(() => buildTraitGroups(baseAssets), [baseAssets]);
  const filteredAssets = useMemo(
    () => baseAssets.filter((asset) => assetMatchesFilters(asset, selectedTraits)),
    [baseAssets, selectedTraits]
  );
  const filteredData = useMemo(
    () => dataForAssets(activeBucket, filteredAssets),
    [activeBucket, filteredAssets]
  );

  function setTraits(nextTraits: TraitFilter[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("trait");

    for (const trait of nextTraits) {
      params.append("trait", encodeTraitFilter(trait));
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  if (!validBucket) {
    return (
      <main className="min-h-screen px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-4xl rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6 text-amber-100">
          Unknown explorer bucket. <Link href="/" className="font-semibold underline">Return to the provenance explorer.</Link>
        </section>
      </main>
    );
  }

  function toggleTrait(trait: TraitFilter) {
    const encoded = encodeTraitFilter(trait);
    const current = selectedTraits.map(encodeTraitFilter);
    const next = current.includes(encoded)
      ? selectedTraits.filter((selected) => encodeTraitFilter(selected) !== encoded)
      : [...selectedTraits, trait];

    setTraits(next);
  }

  return (
    <main className="min-h-screen px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-glow backdrop-blur md:p-7">
          <Link href="/" className="text-xs font-bold uppercase tracking-[0.24em] text-solana-green hover:text-white">
            Back to overview
          </Link>
          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-black leading-tight tracking-tight text-white md:text-5xl">{config.label}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">{config.description}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-3xl font-black text-white">
                {bucketData ? bucketData.count.toLocaleString() : "..."}
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">Assets in bucket</div>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6 text-sm text-amber-100">
            {error}
          </div>
        ) : data && bucketData ? (
          <>
            <TraitExplorer
              groups={traitGroups}
              selectedTraits={selectedTraits}
              filteredCount={filteredAssets.length}
              totalCount={baseAssets.length}
              onToggleTrait={toggleTrait}
              onClear={() => setTraits([])}
            />
            <PairTable data={filteredData} initialViewMode={config.tableViewMode} lockedViewMode />
          </>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-10 text-center text-sm text-slate-300">
            Loading bucket data...
          </div>
        )}
      </section>
    </main>
  );
}

function TraitExplorer({
  groups,
  selectedTraits,
  filteredCount,
  totalCount,
  onToggleTrait,
  onClear
}: {
  groups: TraitGroup[];
  selectedTraits: TraitFilter[];
  filteredCount: number;
  totalCount: number;
  onToggleTrait: (trait: TraitFilter) => void;
  onClear: () => void;
}) {
  const selectedEncodings = new Set(selectedTraits.map(encodeTraitFilter));

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur md:p-5">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Trait Distribution</h2>
          <p className="mt-1 text-sm text-slate-400">
            Showing <span className="font-semibold text-white">{filteredCount.toLocaleString()}</span> of{" "}
            <span className="font-semibold text-white">{totalCount.toLocaleString()}</span> assets. Percentages are within this bucket.
          </p>
        </div>
        {selectedTraits.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-300 hover:border-solana-purple/70 hover:text-white"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {selectedTraits.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-white/10 py-4">
          {selectedTraits.map((trait) => (
            <button
              type="button"
              key={encodeTraitFilter(trait)}
              onClick={() => onToggleTrait(trait)}
              className="rounded-full bg-solana-purple/25 px-3 py-1 text-xs font-semibold text-white hover:bg-solana-purple/40"
            >
              {trait.key}: {trait.value} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {groups.map((group) => {
          const selectedInGroup = group.options.some((option) => selectedEncodings.has(encodeTraitFilter(option)));

          return (
            <details
              key={group.key}
              open={selectedInGroup}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
            >
              <summary className="cursor-pointer text-sm font-bold uppercase tracking-[0.16em] text-slate-300">
                {group.key} <span className="text-slate-500">({group.total.toLocaleString()})</span>
              </summary>
              <div className="mt-3 flex max-h-72 flex-wrap gap-2 overflow-y-auto pr-1">
                {group.options.map((option) => {
                  const active = selectedEncodings.has(encodeTraitFilter(option));

                  return (
                    <button
                      type="button"
                      key={encodeTraitFilter(option)}
                      onClick={() => onToggleTrait(option)}
                      className={`rounded-full border px-3 py-1 text-left text-xs transition ${
                        active
                          ? "border-solana-purple bg-solana-purple/30 text-white"
                          : "border-white/10 bg-black/20 text-slate-300 hover:border-solana-purple/70 hover:text-white"
                      }`}
                      title={`${option.key}: ${option.value}`}
                    >
                      <span className="font-semibold">{option.value}</span>{" "}
                      <span className="text-slate-400">
                        {option.count.toLocaleString()} · {formatPercent(option.percent)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function bucketAssets(bucket: ExplorerBucket, originalTokens: OriginalTokenRecord[], nfts: NftRecord[]): BucketAsset[] {
  if (bucket === "original-ft") {
    return originalTokens.map((record) => ({
      kind: "original-ft",
      record,
      tokenBs: tokenBsForOriginalRecord(record)
    }));
  }

  return nfts.map((record) => ({
    kind: "nft",
    record,
    tokenBs: [record.tokenB]
  }));
}

function dataForAssets(bucket: ExplorerBucket, assets: BucketAsset[]): ProvenanceData {
  if (bucket === "original-ft") {
    return {
      originalTokens: assets
        .filter((asset): asset is Extract<BucketAsset, { kind: "original-ft" }> => asset.kind === "original-ft")
        .map((asset) => asset.record),
      nfts: []
    };
  }

  return {
    originalTokens: [],
    nfts: assets
      .filter((asset): asset is Extract<BucketAsset, { kind: "nft" }> => asset.kind === "nft")
      .map((asset) => asset.record)
  };
}

function buildTraitGroups(assets: BucketAsset[]): TraitGroup[] {
  const groupCounts = new Map<string, Map<string, number>>();
  const groupTotals = new Map<string, number>();
  const totalAssets = Math.max(assets.length, 1);

  for (const asset of assets) {
    const seenForAsset = new Set<string>();

    for (const tokenB of asset.tokenBs) {
      for (const [key, rawValue] of Object.entries(tokenB.attributes ?? {})) {
        if (EXCLUDED_TRAIT_KEYS.has(key) || rawValue === null || typeof rawValue === "undefined" || rawValue === "") {
          continue;
        }

        const value = String(rawValue);
        const identity = `${key}\u0000${value}`;

        if (seenForAsset.has(identity)) {
          continue;
        }

        seenForAsset.add(identity);
        const counts = groupCounts.get(key) ?? new Map<string, number>();
        counts.set(value, (counts.get(value) ?? 0) + 1);
        groupCounts.set(key, counts);
        groupTotals.set(key, (groupTotals.get(key) ?? 0) + 1);
      }
    }
  }

  return [...groupCounts.entries()]
    .map(([key, counts]) => ({
      key,
      total: groupTotals.get(key) ?? 0,
      options: [...counts.entries()]
        .map(([value, count]) => ({
          key,
          value,
          count,
          percent: count / totalAssets
        }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true }))
    }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

function assetMatchesFilters(asset: BucketAsset, filters: TraitFilter[]) {
  if (filters.length === 0) {
    return true;
  }

  return filters.every((filter) =>
    asset.tokenBs.some((tokenB) => {
      const value = tokenB.attributes?.[filter.key];
      return typeof value !== "undefined" && value !== null && String(value) === filter.value;
    })
  );
}

function encodeTraitFilter(filter: TraitFilter) {
  return `${filter.key}::${filter.value}`;
}

function decodeTraitFilters(values: string[]): TraitFilter[] {
  return values
    .map((value) => {
      const [key, ...rest] = value.split("::");
      const traitValue = rest.join("::");

      if (!key || !traitValue) {
        return null;
      }

      return {
        key,
        value: traitValue
      };
    })
    .filter((filter): filter is TraitFilter => Boolean(filter));
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}
