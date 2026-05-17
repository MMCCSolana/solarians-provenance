"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { NftRecord, OriginalTokenRecord, ProvenanceData, ProvenancePair, TokenA, TokenB } from "@/lib/types";

type ViewMode = "original-ft" | "original-nft" | "entangled-nft";
type SortMode =
  | "mintNumber"
  | "currentOwner"
  | "swapStatus"
  | "tokenAMint"
  | "tokenBMint"
  | "nftName"
  | "mintDate"
  | "tokenType"
  | "nftCount";
type SortDirection = "asc" | "desc";

const TEAM_WALLET = "4nuNUbvQQ6hsYLFB9yAeDdhHRbbxa3vHQwhBbMkD66Sf";
const PAGE_SIZE = 100;

export default function PairTable({ data }: { data: ProvenanceData }) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("original-ft");
  const [sortMode, setSortMode] = useState<SortMode>("mintNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);

  const records = data.originalTokens;
  const nftRows = data.nfts;
  const originalNftRows = useMemo(() => nftRows.filter((row) => nftBucket(row) === "original-nft"), [nftRows]);
  const entangledNftRows = useMemo(() => nftRows.filter((row) => nftBucket(row) === "entangled-nft"), [nftRows]);
  const activeNftRows = viewMode === "original-nft" ? originalNftRows : entangledNftRows;

  const filteredRecords = useMemo(() => {
    const filtered = records.filter((record) => recordMatches(record, query));
    return sortTokenRecords(filtered, sortMode, sortDirection);
  }, [query, records, sortDirection, sortMode]);

  const filteredRows = useMemo(() => {
    const filtered = activeNftRows.filter((row) => rowMatches(row, query));
    return sortNftRows(filtered, sortMode, sortDirection);
  }, [activeNftRows, query, sortDirection, sortMode]);

  const visibleCount = viewMode === "original-ft" ? filteredRecords.length : filteredRows.length;
  const totalCount = viewMode === "original-ft" ? records.length : activeNftRows.length;
  const totalPages = Math.max(1, Math.ceil(visibleCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pagedRecords = filteredRecords.slice(pageStart, pageEnd);
  const pagedRows = filteredRows.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage(1);
  }, [query, sortDirection, sortMode, viewMode]);

  useEffect(() => {
    if (viewMode === "original-nft" && (sortMode === "tokenAMint" || sortMode === "swapStatus" || sortMode === "tokenType" || sortMode === "nftCount")) {
      setSortMode("mintNumber");
      setSortDirection(defaultSortDirection("mintNumber"));
    }
  }, [sortMode, viewMode]);

  function changeSort(nextSortMode: SortMode) {
    const isSameSort = sortMode === nextSortMode;
    setSortDirection((currentDirection) =>
      isSameSort ? (currentDirection === "asc" ? "desc" : "asc") : defaultSortDirection(nextSortMode)
    );
    setSortMode(nextSortMode);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => ({
      ...current,
      [id]: !current[id]
    }));
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 p-4 backdrop-blur md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="provenance-search">
              Search provenance records
            </label>
            <input
              id="provenance-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search mints, names, mint #, wallets, entangler..."
              className="min-h-11 flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm text-white outline-none ring-solana-purple/40 placeholder:text-slate-500 focus:border-solana-purple/70 focus:ring-4"
            />
            <select
              value={sortMode}
              onChange={(event) => changeSort(event.target.value as SortMode)}
              className="min-h-11 rounded-2xl border border-white/10 bg-slate-900 px-4 text-sm font-semibold text-white outline-none ring-solana-purple/40 focus:border-solana-purple/70 focus:ring-4"
            >
              <option value="mintNumber">Sort by Mint Order</option>
              <option value="currentOwner">Sort by Current Owner</option>
              {viewMode !== "original-nft" ? <option value="swapStatus">Sort by Exchange Status</option> : null}
              <option value="mintDate">Sort by Mint Date</option>
              {viewMode !== "original-nft" ? <option value="tokenAMint">Sort by Original FT Mint</option> : null}
              <option value="tokenBMint">Sort by NFT Mint</option>
              <option value="nftName">Sort by NFT Name</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"))}
              className="min-h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-xs font-bold uppercase tracking-widest text-slate-300 hover:border-solana-purple/70 hover:text-white"
              title="Toggle sort direction"
            >
              {sortDirection === "asc" ? "Asc ↑" : "Desc ↓"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300">
              Showing <span className="font-semibold text-white">{visibleCount.toLocaleString()}</span> of{" "}
              <span className="font-semibold text-white">{totalCount.toLocaleString()}</span>
            </div>
            <div className="flex flex-wrap rounded-2xl border border-white/10 bg-black/30 p-1">
              <ModeButton active={viewMode === "original-ft"} onClick={() => setViewMode("original-ft")}>
                Original FT Tokens
              </ModeButton>
              <ModeButton active={viewMode === "original-nft"} onClick={() => setViewMode("original-nft")}>
                Original NFT Mints
              </ModeButton>
              <ModeButton active={viewMode === "entangled-nft"} onClick={() => setViewMode("entangled-nft")}>
                Entangled NFT Mints
              </ModeButton>
            </div>
          </div>
        </div>
      </div>

      {records.length === 0 && nftRows.length === 0 ? (
        <EmptyState />
      ) : viewMode === "original-ft" ? (
        <OriginalTokenTable
          records={pagedRecords}
          expanded={expanded}
          sortMode={sortMode}
          sortDirection={sortDirection}
          onSort={changeSort}
          onToggle={toggleExpanded}
        />
      ) : (
        <NftTable
          rows={pagedRows}
          variant={viewMode}
          expanded={expanded}
          sortMode={sortMode}
          sortDirection={sortDirection}
          onSort={changeSort}
          onToggle={toggleExpanded}
        />
      )}
      {records.length > 0 || nftRows.length > 0 ? (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageStart={pageStart}
          pageEnd={Math.min(pageEnd, visibleCount)}
          visibleCount={visibleCount}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}

function ModeButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-xs font-semibold ${
        active ? "bg-solana-purple text-white" : "text-slate-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="p-10 text-center">
      <h2 className="text-xl font-bold text-white">No provenance data yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
        Add `NEXT_PUBLIC_HELIUS_RPC_URL` to your environment and run `npm run fetch:pairs` to generate
        `data/pairs.json`.
      </p>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  direction,
  onSort
}: {
  label: string;
  sortKey: SortMode;
  active: boolean;
  direction: SortDirection;
  onSort: (sortMode: SortMode) => void;
}) {
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.16em] hover:text-white ${
          active ? "text-solana-green" : "text-slate-400"
        }`}
      >
        {label}
        <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function Pagination({
  currentPage,
  totalPages,
  pageStart,
  pageEnd,
  visibleCount,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
}) {
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const nearbyPages = pageWindow(currentPage, totalPages);

  useEffect(() => {
    setPageDraft(String(currentPage));
  }, [currentPage]);

  function submitPage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(pageDraft);

    if (!Number.isFinite(parsed)) {
      setPageDraft(String(currentPage));
      return;
    }

    onPageChange(clampPage(Math.trunc(parsed), totalPages));
  }

  return (
    <div className="flex flex-col gap-4 border-t border-white/10 bg-slate-950/95 p-4 text-sm text-slate-300 lg:flex-row lg:items-center lg:justify-between">
      <div>
        Rows <span className="font-semibold text-white">{visibleCount === 0 ? 0 : pageStart + 1}</span>-
        <span className="font-semibold text-white">{pageEnd}</span> of{" "}
        <span className="font-semibold text-white">{visibleCount.toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          First
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <div className="hidden items-center gap-1 md:flex">
          {nearbyPages.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`min-w-10 rounded-xl border px-3 py-2 font-mono text-xs font-semibold ${
                pageNumber === currentPage
                  ? "border-solana-purple bg-solana-purple text-white"
                  : "border-white/10 bg-black/20 text-slate-300 hover:text-white"
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Last
        </button>
        <form onSubmit={submitPage} className="ml-0 flex items-center gap-2 lg:ml-2">
          <label htmlFor="page-jump" className="text-xs uppercase tracking-widest text-slate-500">
            Page
          </label>
          <input
            id="page-jump"
            type="number"
            min={1}
            max={totalPages}
            value={pageDraft}
            onChange={(event) => setPageDraft(event.target.value)}
            className="h-10 w-20 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-sm text-white outline-none ring-solana-purple/40 focus:border-solana-purple/70 focus:ring-4"
          />
          <span className="font-mono text-xs text-slate-500">/ {totalPages}</span>
          <button
            type="submit"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white hover:border-solana-purple/70"
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
}

function OriginalTokenTable({
  records,
  expanded,
  sortMode,
  sortDirection,
  onSort,
  onToggle
}: {
  records: OriginalTokenRecord[];
  expanded: Record<string, boolean>;
  sortMode: SortMode;
  sortDirection: SortDirection;
  onSort: (sortMode: SortMode) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/10 text-left text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.16em] text-slate-400">
          <tr>
            <th className="px-4 py-3">Thumb</th>
            <SortableHeader label="Name" sortKey="nftName" active={sortMode === "nftName"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="FT Mint" sortKey="tokenAMint" active={sortMode === "tokenAMint"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Type" sortKey="tokenType" active={sortMode === "tokenType"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Entangled NFTs" sortKey="nftCount" active={sortMode === "nftCount"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Mint Order" sortKey="mintNumber" active={sortMode === "mintNumber"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Mint Date" sortKey="mintDate" active={sortMode === "mintDate"} direction={sortDirection} onSort={onSort} />
            <th className="px-4 py-3">Current Holders</th>
            <SortableHeader
              label="Exchange Status"
              sortKey="swapStatus"
              active={sortMode === "swapStatus"}
              direction={sortDirection}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {records.map((record) => {
            const id = record.tokenA.mint;
            const isExpanded = expanded[id];
            const swappedCount = record.pairs.filter((pair) => pair.swapped).length;
            const unentangledCount = record.pairs.length - swappedCount;
            const mintNumbers = record.pairs
              .map((pair) => pair.tokenB.mintNumber)
              .filter((mintNumber): mintNumber is number => typeof mintNumber === "number")
              .sort((a, b) => a - b);

            const thumbnailToken = record.pairs[0]?.tokenB;
            const displayName = thumbnailToken?.name || record.tokenA.metadata?.name || "Unnamed Solarian";

            return (
              <RowGroup key={id} colSpan={9}>
                <tr
                  onClick={() => onToggle(id)}
                  className="cursor-pointer bg-slate-950/40 hover:bg-white/[0.04]"
                >
                  <td className="px-4 py-4">
                    <TokenThumbnail tokenB={thumbnailToken} />
                  </td>
                  <td className="max-w-64 px-4 py-4 font-medium text-white">
                    <MagicEdenLink mint={record.tokenA.mint}>{displayName}</MagicEdenLink>
                  </td>
                  <td className="px-4 py-4">
                    <AddressActions address={record.tokenA.mint} />
                  </td>
                  <td className="px-4 py-4">
                    <TypeBadge type={record.tokenA.type} />
                  </td>
                  <td className="px-4 py-4 font-semibold text-white">{record.pairs.length}</td>
                  <td className="px-4 py-4 text-slate-300">
                    {mintNumbers.length > 0 ? formatMintNumber(mintNumbers[0]) : "Unknown"}
                  </td>
                  <td className="px-4 py-4">
                    <DateText value={record.tokenA.mintedAt} />
                  </td>
                  <td className="px-4 py-4">
                    <HolderSummary tokenA={record.tokenA} />
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge
                      swapped={record.pairs.length > 0 && unentangledCount === 0}
                      label={
                        record.pairs.length === 0
                          ? "Not exchanged"
                          : unentangledCount > 0
                          ? `${swappedCount}/${record.pairs.length} exchanged`
                          : `${record.pairs.length}/${record.pairs.length} exchanged`
                      }
                    />
                  </td>
                </tr>
                {isExpanded ? (
                  <tr>
                    <td colSpan={9} className="bg-black/20 p-4">
                      <TokenExpansion record={record} />
                    </td>
                  </tr>
                ) : null}
              </RowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NftTable({
  rows,
  variant,
  expanded,
  sortMode,
  sortDirection,
  onSort,
  onToggle
}: {
  rows: NftRecord[];
  variant: Exclude<ViewMode, "original-ft">;
  expanded: Record<string, boolean>;
  sortMode: SortMode;
  sortDirection: SortDirection;
  onSort: (sortMode: SortMode) => void;
  onToggle: (id: string) => void;
}) {
  const isEntangledView = variant === "entangled-nft";
  const colSpan = isEntangledView ? 8 : 6;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/10 text-left text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.16em] text-slate-400">
          <tr>
            <th className="px-4 py-3">NFT</th>
            <SortableHeader label="Mint #" sortKey="mintNumber" active={sortMode === "mintNumber"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Name" sortKey="nftName" active={sortMode === "nftName"} direction={sortDirection} onSort={onSort} />
            {isEntangledView ? (
              <SortableHeader label="Original FT Mint" sortKey="tokenAMint" active={sortMode === "tokenAMint"} direction={sortDirection} onSort={onSort} />
            ) : null}
            <SortableHeader label="NFT Mint" sortKey="tokenBMint" active={sortMode === "tokenBMint"} direction={sortDirection} onSort={onSort} />
            <SortableHeader label="Mint Date" sortKey="mintDate" active={sortMode === "mintDate"} direction={sortDirection} onSort={onSort} />
            <SortableHeader
              label="Current Owner"
              sortKey="currentOwner"
              active={sortMode === "currentOwner"}
              direction={sortDirection}
              onSort={onSort}
            />
            {isEntangledView ? (
              <SortableHeader label="Status" sortKey="swapStatus" active={sortMode === "swapStatus"} direction={sortDirection} onSort={onSort} />
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row) => {
            const id = `${row.tokenA?.mint ?? "unentangled"}:${row.tokenB.mint}`;
            const isExpanded = expanded[id];

            return (
              <RowGroup key={id} colSpan={colSpan}>
                <tr onClick={() => onToggle(id)} className="cursor-pointer bg-slate-950/40 hover:bg-white/[0.04]">
                  <td className="px-4 py-4">
                    <NftImage tokenB={row.tokenB} />
                  </td>
                  <td className="px-4 py-4 font-mono font-semibold text-solana-green">
                    {formatMintNumber(row.tokenB.mintNumber)}
                  </td>
                  <td className="max-w-64 px-4 py-4 font-medium text-white">
                    <div className="flex flex-col gap-2">
                      <MagicEdenLink mint={row.tokenB.mint}>{row.tokenB.name || "Unnamed Solarian"}</MagicEdenLink>
                      <LifecycleBadge status={row.tokenB.lifecycleStatus} />
                    </div>
                  </td>
                  {isEntangledView ? (
                    <td className="px-4 py-4">
                      <NullableAddress address={row.tokenA?.mint} emptyLabel="No entangled FT" />
                    </td>
                  ) : null}
                  <td className="px-4 py-4">
                    <AddressActions address={row.tokenB.mint} />
                  </td>
                  <td className="px-4 py-4">
                    <DateText value={row.tokenB.mintedAt} />
                  </td>
                  <td className="px-4 py-4">
                    <NullableAddress address={row.tokenB.currentOwner} />
                  </td>
                  {isEntangledView ? (
                    <td className="px-4 py-4">
                      {row.entangledPairAddress ? (
                        <StatusBadge swapped={row.swapped} />
                      ) : (
                        <StatusBadge swapped={false} label="No Entangler record" />
                      )}
                    </td>
                  ) : null}
                </tr>
                {isExpanded ? (
                  <tr>
                    <td colSpan={colSpan} className="bg-black/20 p-4">
                      <NftExpansion record={row} />
                    </td>
                  </tr>
                ) : null}
              </RowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode; colSpan: number }) {
  return <>{children}</>;
}

function TokenExpansion({ record }: { record: OriginalTokenRecord }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
      <TokenADetails tokenA={record.tokenA} />
      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-300">Mapped NFTs</h3>
        {record.pairs.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {record.pairs.map((pair) => (
              <NftCard key={`${pair.entangledPairAddress}:${pair.tokenB.mint}`} pair={pair} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No NFT is linked to this original FT by a Token Entangler account yet.</p>
        )}
      </div>
    </div>
  );
}

function NftExpansion({ record }: { record: NftRecord }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
      {record.tokenA ? <TokenADetails tokenA={record.tokenA} /> : <MissingTokenADetails />}
      <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-300">NFT Details</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr]">
          <NftImage tokenB={record.tokenB} large />
          <div className="space-y-3">
            <Detail label="Name" value={record.tokenB.name || "Unknown"} />
            <Detail label="Symbol" value={record.tokenB.symbol || "Unknown"} />
            <Detail label="Entangled Pair">
              <NullableAddress address={record.entangledPairAddress} full emptyLabel="Not entangled" />
            </Detail>
            <Detail label="Token B Mint">
              <AddressActions address={record.tokenB.mint} full />
            </Detail>
            <Detail label="Current Owner">
              <NullableAddress address={record.tokenB.currentOwner} full />
            </Detail>
            {record.tokenB.lifecycleStatus ? (
              <Detail label="Lifecycle">
                <LifecycleBadge status={record.tokenB.lifecycleStatus} />
              </Detail>
            ) : null}
            <Attributes attributes={record.tokenB.attributes} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenADetails({ tokenA }: { tokenA: TokenA }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-300">Original Token</h3>
      <div className="mt-4 space-y-3">
        <Detail label="Mint">
          <AddressActions address={tokenA.mint} full />
        </Detail>
        <Detail label="Type" value={tokenA.type === "true_fungible" ? "True fungible" : "NFT-like"} />
        <Detail label="Metadata">
          <div className="space-y-2">
            <div>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  tokenA.metadata?.validOriginal
                    ? "bg-solana-green/20 text-solana-green"
                    : "bg-amber-500/15 text-amber-200"
                }`}
              >
                {tokenA.metadata?.validOriginal ? "Valid Solarian" : "Not validated"}
              </span>
            </div>
            <div className="text-sm text-slate-300">
              {[tokenA.metadata?.name, tokenA.metadata?.symbol].filter(Boolean).join(" / ") || "No metadata found"}
            </div>
          </div>
        </Detail>
        <Detail label="Mint Authority">
          <NullableAddress address={tokenA.minter} full />
        </Detail>
        <Detail label="Mint Date" value={formatDate(tokenA.mintedAt)} />
        <Detail label="Decimals" value={tokenA.decimals.toString()} />
        <Detail label="Supply" value={tokenA.supply} />
        <Detail label="Original Recipients">
          <AddressList addresses={tokenA.originalRecipients} full />
        </Detail>
        <Detail label="Current Holders">
          <div className="space-y-2">
            {tokenA.currentHolders.length > 0 ? (
              tokenA.currentHolders.map((holder) => (
                <div key={`${holder.owner}:${holder.tokenAccount ?? ""}`} className="rounded-xl bg-white/[0.04] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <AddressActions address={holder.owner} full />
                    {holder.teamHeld ? (
                      <span className="rounded-full bg-solana-purple/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-solana-green">
                        Team-held
                      </span>
                    ) : null}
                  </div>
                  {holder.amount ? <div className="mt-1 font-mono text-xs text-slate-400">Amount: {holder.amount}</div> : null}
                </div>
              ))
            ) : (
              <span className="text-slate-500">No non-zero holders found</span>
            )}
          </div>
        </Detail>
      </div>
    </div>
  );
}

function MissingTokenADetails() {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-300">Original Token</h3>
      <p className="mt-4 text-sm leading-6 text-slate-400">
        No original FT is linked to this NFT by a Token Entangler account yet.
      </p>
    </div>
  );
}

function NftCard({ pair }: { pair: ProvenancePair }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex gap-3">
        <NftImage tokenB={pair.tokenB} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs font-bold text-solana-green">{formatMintNumber(pair.tokenB.mintNumber)}</div>
          <div className="truncate text-sm font-semibold text-white">{pair.tokenB.name || "Unnamed Solarian"}</div>
          <div className="mt-2">
            <StatusBadge swapped={pair.swapped} />
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <AddressActions address={pair.tokenB.mint} full />
        {pair.entangledPairAddress ? (
          <AddressActions address={pair.entangledPairAddress} full />
        ) : (
          <span className="text-xs text-slate-500">No EntangledPair account</span>
        )}
      </div>
    </div>
  );
}

function NftImage({ tokenB, large = false }: { tokenB: TokenB; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = imageWithFallback(tokenB.image, failed);
  const sizeClass = large ? "h-32 w-32" : "h-16 w-16";

  if (!src) {
    return (
      <div className={`grid shrink-0 place-items-center rounded-xl border border-white/10 bg-solana-purple/10 text-xs font-bold text-solana-green ${sizeClass}`}>
        SLR
      </div>
    );
  }

  return (
    <div className={`relative shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/20 ${sizeClass}`}>
      <Image
        src={src}
        alt={tokenB.name || "Solarian NFT"}
        fill
        sizes={large ? "128px" : "64px"}
        loading="lazy"
        unoptimized
        onError={() => setFailed(true)}
        className="object-cover"
      />
    </div>
  );
}

function TokenThumbnail({ tokenB }: { tokenB?: TokenB }) {
  if (!tokenB) {
    return (
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-[10px] font-bold uppercase tracking-widest text-slate-500">
        None
      </div>
    );
  }

  return <NftImage tokenB={tokenB} />;
}

function AddressActions({ address, full = false }: { address: string; full?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs text-slate-200">
      <span className="truncate">{full ? address : truncateAddress(address)}</span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard.writeText(address);
        }}
        className="text-slate-500 hover:text-solana-green"
        title="Copy address"
      >
        Copy
      </button>
      <a
        href={`https://solscan.io/account/${address}`}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="text-slate-500 hover:text-solana-purple"
        title="Open in Solscan"
      >
        ↗
      </a>
    </span>
  );
}

function MagicEdenLink({ mint, children }: { mint: string; children: React.ReactNode }) {
  return (
    <a
      href={`https://magiceden.us/item-details/${mint}`}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="block truncate text-white hover:text-solana-green"
      title="Open on Magic Eden"
    >
      {children}
    </a>
  );
}

function DateText({ value }: { value?: string | null }) {
  return <span className="font-mono text-xs text-slate-300">{formatDate(value)}</span>;
}

function NullableAddress({
  address,
  full = false,
  emptyLabel = "Unknown"
}: {
  address: string | null | undefined;
  full?: boolean;
  emptyLabel?: string;
}) {
  return address ? <AddressActions address={address} full={full} /> : <span className="text-slate-500">{emptyLabel}</span>;
}

function AddressList({ addresses, full = false }: { addresses: string[]; full?: boolean }) {
  if (addresses.length === 0) {
    return <span className="text-slate-500">Unknown</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      {addresses.map((address) => (
        <AddressActions key={address} address={address} full={full} />
      ))}
    </div>
  );
}

function HolderSummary({ tokenA }: { tokenA: TokenA }) {
  const holderCount = tokenA.currentHolders.length;
  const teamHeld = tokenA.currentHolders.some((holder) => holder.teamHeld);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-white">{holderCount}</span>
      <span className="text-slate-400">{holderCount === 1 ? "holder" : "holders"}</span>
      {teamHeld ? (
        <span className="rounded-full bg-solana-purple/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-solana-green">
          Team-held
        </span>
      ) : null}
    </div>
  );
}

function TypeBadge({ type }: { type: TokenA["type"] }) {
  const isFungible = type === "true_fungible";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
        isFungible ? "bg-solana-green/15 text-solana-green" : "bg-solana-purple/20 text-purple-200"
      }`}
    >
      {isFungible ? "FT" : "NFT-like"}
    </span>
  );
}

function StatusBadge({ swapped, label }: { swapped: boolean; label?: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
        swapped ? "bg-solana-green/15 text-solana-green" : "bg-amber-400/15 text-amber-200"
      }`}
    >
      {label ?? (swapped ? "Exchanged" : "Awaiting exchange")}
    </span>
  );
}

function LifecycleBadge({ status }: { status?: TokenB["lifecycleStatus"] }) {
  if (status !== "burned") {
    return null;
  }

  return (
    <span className="w-fit rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200">
      Burned
    </span>
  );
}

function Detail({
  label,
  value,
  children
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="text-sm text-slate-200">{children ?? value}</div>
    </div>
  );
}

function Attributes({ attributes }: { attributes?: Record<string, string | number | boolean | null> }) {
  const entries = Object.entries(attributes ?? {});

  if (entries.length === 0) {
    return <Detail label="Attributes" value="None found" />;
  }

  return (
    <Detail label="Attributes">
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-xl bg-white/[0.04] p-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{key}</div>
            <div className="mt-1 text-sm text-white">{String(value ?? "")}</div>
          </div>
        ))}
      </div>
    </Detail>
  );
}

function sortTokenRecords(records: OriginalTokenRecord[], sortMode: SortMode, sortDirection: SortDirection) {
  return [...records].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    let result: number;

    if (sortMode === "tokenAMint") {
      result = a.tokenA.mint.localeCompare(b.tokenA.mint);
    } else if (sortMode === "tokenType") {
      result = a.tokenA.type.localeCompare(b.tokenA.type);
    } else if (sortMode === "nftCount") {
      result = a.pairs.length - b.pairs.length;
    } else if (sortMode === "nftName") {
      result = (a.pairs[0]?.tokenB.name ?? a.tokenA.metadata?.name ?? "").localeCompare(
        b.pairs[0]?.tokenB.name ?? b.tokenA.metadata?.name ?? ""
      );
    } else if (sortMode === "mintDate") {
      result = timestampValue(a.tokenA.mintedAt) - timestampValue(b.tokenA.mintedAt);
    } else if (sortMode === "currentOwner") {
      result = firstOwner(a).localeCompare(firstOwner(b));
    } else if (sortMode === "swapStatus") {
      result = swappedScore(a) - swappedScore(b);
    } else {
      result = firstMintNumber(a) - firstMintNumber(b);
    }

    return result * direction || a.tokenA.mint.localeCompare(b.tokenA.mint);
  });
}

function sortNftRows(rows: NftRecord[], sortMode: SortMode, sortDirection: SortDirection) {
  return [...rows].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    let result: number;

    if (sortMode === "tokenAMint") {
      result = (a.tokenA?.mint ?? "").localeCompare(b.tokenA?.mint ?? "");
    } else if (sortMode === "tokenBMint") {
      result = a.tokenB.mint.localeCompare(b.tokenB.mint);
    } else if (sortMode === "nftName") {
      result = (a.tokenB.name ?? "").localeCompare(b.tokenB.name ?? "");
    } else if (sortMode === "mintDate") {
      result = timestampValue(a.tokenB.mintedAt) - timestampValue(b.tokenB.mintedAt);
    } else if (sortMode === "currentOwner") {
      result = (a.tokenB.currentOwner ?? "").localeCompare(b.tokenB.currentOwner ?? "");
    } else if (sortMode === "swapStatus") {
      result = Number(a.swapped) - Number(b.swapped);
    } else {
      result = (a.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER) - (b.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER);
    }

    return result * direction || a.tokenB.mint.localeCompare(b.tokenB.mint);
  });
}

function nftBucket(row: NftRecord): Exclude<ViewMode, "original-ft"> {
  return row.provenanceBucket ?? (row.entangledPairAddress ? "entangled-nft" : "original-nft");
}

function recordMatches(record: OriginalTokenRecord, query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return searchableRecord(record).includes(normalized);
}

function rowMatches(row: NftRecord, query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return searchableRow(row).includes(normalized);
}

function searchableRecord(record: OriginalTokenRecord) {
  return [
    record.tokenA.mint,
    record.tokenA.minter,
    record.tokenA.mintedAt,
    record.tokenA.metadata?.name,
    record.tokenA.metadata?.symbol,
    record.tokenA.metadata?.description,
    ...record.tokenA.originalRecipients,
    ...record.tokenA.currentHolders.map((holder) => holder.owner),
    ...record.pairs.flatMap((pair) => searchablePair(pair))
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchableRow(row: NftRecord) {
  return [
    row.tokenA?.mint,
    row.tokenA?.minter,
    row.tokenA?.mintedAt,
    row.tokenA?.metadata?.name,
    row.tokenA?.metadata?.symbol,
    row.tokenA?.metadata?.description,
    row.provenanceBucket,
    ...(row.tokenA?.originalRecipients ?? []),
    ...(row.tokenA?.currentHolders.map((holder) => holder.owner) ?? []),
    row.entangledPairAddress,
    ...searchableTokenB(row.tokenB)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchablePair(pair: ProvenancePair) {
  return [
    pair.entangledPairAddress,
    ...searchableTokenB(pair.tokenB)
  ];
}

function searchableTokenB(tokenB: TokenB) {
  return [
    tokenB.mint,
    tokenB.name,
    tokenB.symbol,
    tokenB.mintNumber?.toString(),
    tokenB.currentOwner,
    tokenB.mintedAt,
    tokenB.lifecycleStatus,
    ...Object.values(tokenB.attributes ?? {}).map((value) => String(value ?? ""))
  ];
}

function firstMintNumber(record: OriginalTokenRecord) {
  return Math.min(
    ...record.pairs.map((pair) => pair.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
}

function firstOwner(record: OriginalTokenRecord) {
  return record.pairs.find((pair) => pair.tokenB.currentOwner)?.tokenB.currentOwner ?? "";
}

function swappedScore(record: OriginalTokenRecord) {
  return record.pairs.length > 0 ? record.pairs.filter((pair) => pair.swapped).length / record.pairs.length : 0;
}

function defaultSortDirection(sortMode: SortMode): SortDirection {
  return sortMode === "nftCount" || sortMode === "swapStatus" ? "desc" : "asc";
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(page, 1), totalPages);
}

function pageWindow(currentPage: number, totalPages: number) {
  const start = clampPage(currentPage - 2, totalPages);
  const end = clampPage(currentPage + 2, totalPages);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}

function formatMintNumber(mintNumber: number | null) {
  return typeof mintNumber === "number" ? `#${mintNumber.toLocaleString()}` : "Unknown";
}

function truncateAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function timestampValue(value?: string | null) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function imageWithFallback(image: string | null, failed: boolean) {
  if (!image) {
    return null;
  }

  if (!failed) {
    return image;
  }

  const match = image.match(/arweave\.net\/([^/?#]+)/);
  return match ? `https://gateway.irys.xyz/${match[1]}` : image;
}

export { TEAM_WALLET };
