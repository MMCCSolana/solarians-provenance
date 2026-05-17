import type { NftRecord, OriginalTokenRecord, ProvenanceData, ProvenanceRecord, TokenB } from "@/lib/types";

export type ExplorerBucket =
  | "original-ft"
  | "original-nft"
  | "entangled-nft"
  | "exchanged"
  | "awaiting-exchange"
  | "burned";

export type TableViewMode = "original-ft" | "original-nft" | "entangled-nft";

export type BucketConfig = {
  id: ExplorerBucket;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  tableViewMode: TableViewMode;
};

export const BUCKET_CONFIGS: BucketConfig[] = [
  {
    id: "original-ft",
    label: "Original FT Tokens",
    shortLabel: "Original FT",
    description: "The original 9-decimal fungible Solarians, shown with their mapped NFT traits.",
    href: "/explore/original-ft",
    tableViewMode: "original-ft"
  },
  {
    id: "original-nft",
    label: "Original NFT Mints",
    shortLabel: "Original NFT",
    description: "Direct NFT-standard Solarian mints from the later website mint era.",
    href: "/explore/original-nft",
    tableViewMode: "original-nft"
  },
  {
    id: "entangled-nft",
    label: "Entangled NFT Mints",
    shortLabel: "Entangled NFT",
    description: "NFTs associated with the original FT era, including Token Entangler records and validated legacy gap fills.",
    href: "/explore/entangled-nft",
    tableViewMode: "entangled-nft"
  },
  {
    id: "exchanged",
    label: "NFTs Exchanged",
    shortLabel: "Exchanged",
    description: "Token Entangler records where the NFT has left the vault and the holder has exchanged.",
    href: "/explore/exchanged",
    tableViewMode: "entangled-nft"
  },
  {
    id: "awaiting-exchange",
    label: "Awaiting Exchange",
    shortLabel: "Awaiting",
    description: "Token Entangler records where the NFT remains in the vault awaiting holder exchange.",
    href: "/explore/awaiting-exchange",
    tableViewMode: "entangled-nft"
  },
  {
    id: "burned",
    label: "Burned NFTs",
    shortLabel: "Burned",
    description: "Known burned NFTs retained for provenance and historical context.",
    href: "/explore/burned",
    tableViewMode: "original-nft"
  }
];

export const BUCKET_CONFIG_BY_ID = Object.fromEntries(BUCKET_CONFIGS.map((config) => [config.id, config])) as Record<
  ExplorerBucket,
  BucketConfig
>;

export function isExplorerBucket(value: string): value is ExplorerBucket {
  return value in BUCKET_CONFIG_BY_ID;
}

export function normalizeProvenanceData(value: unknown): ProvenanceData {
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

export function nftBucket(record: NftRecord): Exclude<TableViewMode, "original-ft"> {
  return record.provenanceBucket ?? (record.entangledPairAddress ? "entangled-nft" : "original-nft");
}

export function getStats(data: ProvenanceData) {
  const entangledNftMints = data.nfts.filter((record) => nftBucket(record) === "entangled-nft").length;
  const originalNftMints = data.nfts.length - entangledNftMints;
  const exchangeEligibleNfts = data.nfts.filter((record) => record.entangledPairAddress);
  const exchanged = exchangeEligibleNfts.filter((record) => record.swapped).length;
  const burnedNfts = data.nfts.filter((record) => record.tokenB.lifecycleStatus === "burned").length;

  return {
    originalFtTokens: data.originalTokens.length,
    originalNftMints,
    entangledNftMints,
    exchanged,
    awaitingExchange: exchangeEligibleNfts.length - exchanged,
    burnedNfts
  };
}

export function getBucketCount(data: ProvenanceData, bucket: ExplorerBucket) {
  return getBucketData(data, bucket).count;
}

export function getBucketData(data: ProvenanceData, bucket: ExplorerBucket): {
  count: number;
  originalTokens: OriginalTokenRecord[];
  nfts: NftRecord[];
} {
  if (bucket === "original-ft") {
    return {
      count: data.originalTokens.length,
      originalTokens: data.originalTokens,
      nfts: []
    };
  }

  const nfts = data.nfts.filter((record) => {
    if (bucket === "original-nft") {
      return nftBucket(record) === "original-nft";
    }

    if (bucket === "entangled-nft") {
      return nftBucket(record) === "entangled-nft";
    }

    if (bucket === "exchanged") {
      return Boolean(record.entangledPairAddress && record.swapped);
    }

    if (bucket === "awaiting-exchange") {
      return Boolean(record.entangledPairAddress && !record.swapped);
    }

    return record.tokenB.lifecycleStatus === "burned";
  });

  return {
    count: nfts.length,
    originalTokens: [],
    nfts
  };
}

export function tokenBsForOriginalRecord(record: OriginalTokenRecord): TokenB[] {
  return record.pairs.map((pair) => pair.tokenB);
}
