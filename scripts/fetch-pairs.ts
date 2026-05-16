import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import bs58 from "bs58";
import dotenv from "dotenv";
import {
  Connection,
  ParsedAccountData,
  ParsedInstruction,
  PublicKey,
  TokenAmount,
  TransactionSignature
} from "@solana/web3.js";
import type {
  Holder,
  NftRecord,
  OriginalTokenRecord,
  ProvenanceData,
  ProvenanceRecord,
  TokenA,
  TokenAMetadata,
  TokenB
} from "../lib/types";

dotenv.config({ path: ".env.local" });
dotenv.config();

const heliusRpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
const TEAM_WALLET = "4nuNUbvQQ6hsYLFB9yAeDdhHRbbxa3vHQwhBbMkD66Sf";
const TOKEN_ENTANGLER_PROGRAM = "qntmGodpGkrM42mN68VCZHXnKqDCT8rdY23wFcXCLPd";
const REFERENCE_PAIR = "J2V5Qipz1u7jN3k9LB8WSsjFrJ96fU3bAVvgUnJBQ7i4";
const REFERENCE_MINT_B = "4ALFFRzUhV3bqBeu4LNoTA5ua5oDeXa9DJ15Sn2ap2v4";
const OUTPUT_PATH = path.join(process.cwd(), "data", "pairs.json");
const RAW_PAIRS_PATH = path.join(process.cwd(), "data", "raw-pairs.json");
const TOKEN_A_CACHE_PATH = path.join(process.cwd(), "data", "token-a-cache.json");
const MINT_DATE_CACHE_PATH = path.join(process.cwd(), "data", "mint-date-cache.json");
const MINT_SNAPSHOT_PATH = path.join(process.cwd(), `${TEAM_WALLET}-mints.json`);
const EARLY_2021_UNIX = 1609459200;
const MAX_TEAM_SIGNATURE_PAGES = Number(process.env.MAX_TEAM_SIGNATURE_PAGES ?? "0");
const REQUEST_BATCH_SIZE = Number(process.env.REQUEST_BATCH_SIZE ?? "8");
const SKIP_TEAM_WALLET_SCAN = process.env.SKIP_TEAM_WALLET_SCAN === "1";
const USE_RAW_PAIRS_CACHE = process.env.USE_RAW_PAIRS_CACHE === "1";
const FAST_SWAP_STATUS = process.env.FAST_SWAP_STATUS === "1";
const FAST_TOKEN_A_ENRICHMENT = process.env.FAST_TOKEN_A_ENRICHMENT === "1";
const ENRICH_MINT_DATES = process.env.ENRICH_MINT_DATES === "1";
const FORCE_TOKEN_A_ENRICHMENT = process.env.FORCE_TOKEN_A_ENRICHMENT === "1";

if (!heliusRpcUrl) {
  throw new Error("NEXT_PUBLIC_HELIUS_RPC_URL is required.");
}

const HELIUS_RPC = heliusRpcUrl;

const connection = new Connection(HELIUS_RPC, {
  commitment: "confirmed"
});

const teamWallet = new PublicKey(TEAM_WALLET);
const entanglerProgram = new PublicKey(TOKEN_ENTANGLER_PROGRAM);
const entangledPairDiscriminator = createHash("sha256").update("account:EntangledPair").digest().subarray(0, 8);
let mintDateCache: Map<string, string | null> | null = null;

type DasAttribute = {
  trait_type?: string;
  value?: string | number | boolean | null;
};

type DasAsset = {
  id: string;
  interface?: string;
  created_at?: string;
  createdAt?: string;
  creators?: Array<{
    address?: string;
    verified?: boolean;
  }>;
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
      attributes?: DasAttribute[];
    };
    files?: Array<{ uri?: string }>;
    links?: {
      image?: string;
    };
  };
  ownership?: {
    owner?: string;
  };
};

type Layout = {
  mintAOffset: number;
  mintBOffset: number;
};

type RawPair = {
  entangledPairAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  accountData: Buffer;
};

type SerializableRawPair = Omit<RawPair, "accountData"> & {
  accountDataBase64: string;
};

type EnrichedPairLink = {
  entangledPairAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenA: TokenA | null;
  tokenB: TokenB;
  swapped: boolean;
};

async function main() {
  console.log("Discovering EntangledPair layout...");
  const layout = await discoverLayout();
  const snapshotMints = await readMintSnapshot();

  console.log("Finding entangled pairs by Token B mint...");
  const cachedRawPairs = USE_RAW_PAIRS_CACHE ? await readRawPairs() : null;
  const discoveredRawPairs = cachedRawPairs ?? (await discoverRawPairs(layout, snapshotMints));
  console.log(`Found ${discoveredRawPairs.length} NFT-backed entangled pair accounts.`);
  await writeRawPairs(discoveredRawPairs);

  console.log(
    SKIP_TEAM_WALLET_SCAN
      ? "Skipping team wallet transaction scan; using existing Token A records as precursor candidates..."
      : "Scanning team wallet transactions for precursor mints..."
  );
  const precursorCandidates = SKIP_TEAM_WALLET_SCAN
    ? await precursorCandidatesFromExistingPairsJson(discoveredRawPairs)
    : await discoverTeamWalletPrecursors();
  console.log(`Found ${precursorCandidates.size} total precursor mint candidates.`);

  console.log("Enriching Token A and Token B records...");
  const data = await enrichRecords(discoveredRawPairs, precursorCandidates, snapshotMints);
  const outputPairCount = data.originalTokens.reduce((total, record) => total + record.pairs.length, 0);
  const invalidOriginalCount = data.originalTokens.filter((record) => !record.tokenA.metadata?.validOriginal).length;
  const invalidNftCount = data.nfts.filter((record) => record.tokenB.symbol !== "SLR").length;

  if (discoveredRawPairs.length > 0 && outputPairCount === 0) {
    throw new Error(
      `Refusing to write ${OUTPUT_PATH}: discovered ${discoveredRawPairs.length} raw pairs, but assembled output has 0 pairs.`
    );
  }

  if (invalidOriginalCount > 0 || invalidNftCount > 0) {
    throw new Error(
      `Refusing to write ${OUTPUT_PATH}: ${invalidOriginalCount} originals and ${invalidNftCount} NFTs failed Solarian validation.`
    );
  }

  await writeJsonFileAtomic(OUTPUT_PATH, data);
  console.log(
    `Wrote ${data.originalTokens.length} original FT records, ${data.nfts.length} NFT records, and ${outputPairCount} entangled links to ${OUTPUT_PATH}.`
  );
}

async function discoverLayout(): Promise<Layout> {
  const account = await connection.getAccountInfo(new PublicKey(REFERENCE_PAIR), "confirmed");

  if (!account) {
    throw new Error(`Reference EntangledPair not found: ${REFERENCE_PAIR}`);
  }

  const data = Buffer.from(account.data);
  const discriminator = data.subarray(0, 8);

  if (!discriminator.equals(entangledPairDiscriminator)) {
    throw new Error(
      `Reference discriminator mismatch. Expected ${entangledPairDiscriminator.toString("hex")}, got ${discriminator.toString(
        "hex"
      )}.`
    );
  }

  const mintBBytes = new PublicKey(REFERENCE_MINT_B).toBuffer();
  const mintBOffset = data.indexOf(mintBBytes);

  if (mintBOffset < 0) {
    throw new Error(`Known mint_b ${REFERENCE_MINT_B} was not found in ${REFERENCE_PAIR}.`);
  }

  const mintAOffset = mintBOffset - 32;

  if (mintAOffset < 8) {
    throw new Error(`Unable to infer mint_a offset from mint_b offset ${mintBOffset}.`);
  }

  const mintA = new PublicKey(data.subarray(mintAOffset, mintAOffset + 32)).toBase58();
  const mintB = new PublicKey(data.subarray(mintBOffset, mintBOffset + 32)).toBase58();

  console.log(`EntangledPair discriminator: ${entangledPairDiscriminator.toString("hex")}`);
  console.log(`mint_a offset: ${mintAOffset} (${mintA})`);
  console.log(`mint_b offset: ${mintBOffset} (${mintB})`);

  return {
    mintAOffset,
    mintBOffset
  };
}

async function getSolariansNftMints() {
  const referenceAsset = await getAsset(REFERENCE_MINT_B);
  const discoveredCreators =
    referenceAsset?.creators?.filter((creator) => creator.verified && creator.address).map((creator) => creator.address as string) ??
    [];
  const creatorAddresses = dedupe([TEAM_WALLET, ...discoveredCreators]);

  if (!discoveredCreators.includes(TEAM_WALLET)) {
    console.log(
      `Reference NFT is not verified by the team wallet in DAS; also querying verified creator(s): ${discoveredCreators.join(", ")}`
    );
  }

  const allMints: string[] = [];

  for (const creatorAddress of creatorAddresses) {
    const mints = await getNftMintsByCreator(creatorAddress);
    console.log(`Creator ${creatorAddress} yielded ${mints.length} verified V1_NFT assets.`);
    allMints.push(...mints);
  }

  if (!allMints.includes(REFERENCE_MINT_B)) {
    console.warn(`Reference NFT ${REFERENCE_MINT_B} was not returned by creator queries; adding it explicitly.`);
    allMints.push(REFERENCE_MINT_B);
  }

  return dedupe(allMints);
}

async function discoverRawPairs(layout: Layout, snapshotMints: string[]) {
  console.log("Fetching Solarians NFTs from Helius DAS...");
  const nftMints = dedupe([...(await getSolariansNftMints()), ...snapshotMints]);
  console.log(`Found ${nftMints.length} verified V1_NFT Solarians.`);

  return [...(await findPairsByNftMint(nftMints, layout)).values()];
}

async function getNftMintsByCreator(creatorAddress: string) {
  const mints: string[] = [];
  let page = 1;

  while (true) {
    const response = await heliusRpc<{ items?: DasAsset[]; total?: number }>("getAssetsByCreator", {
      creatorAddress,
      onlyVerified: true,
      page,
      limit: 1000
    });

    const items = response.items ?? [];
    const nftItems = items.filter((asset) => asset.interface === "V1_NFT");
    mints.push(...nftItems.map((asset) => asset.id));
    console.log(`DAS ${creatorAddress} page ${page}: ${nftItems.length}/${items.length} V1_NFT assets.`);

    if (items.length < 1000) {
      break;
    }

    page += 1;
  }

  return mints;
}

async function findPairsByNftMint(nftMints: string[], layout: Layout) {
  const pairs = new Map<string, RawPair>();
  const groups = chunk(nftMints, REQUEST_BATCH_SIZE);

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    console.log(`getProgramAccounts batch ${index + 1}/${groups.length}`);
    const results = await Promise.allSettled(group.map((mint) => getPairsForMintB(mint, layout)));

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const pair of result.value) {
          pairs.set(pair.entangledPairAddress, pair);
        }
      } else {
        console.warn(`getProgramAccounts batch item failed: ${result.reason}`);
      }
    }
  }

  return pairs;
}

async function writeRawPairs(rawPairs: RawPair[]) {
  const serializable = rawPairs.map((pair) => ({
    entangledPairAddress: pair.entangledPairAddress,
    tokenAMint: pair.tokenAMint,
    tokenBMint: pair.tokenBMint,
    accountDataBase64: pair.accountData.toString("base64")
  }));

  await writeJsonFileAtomic(RAW_PAIRS_PATH, serializable);
  console.log(`Wrote ${serializable.length} raw pair mappings to ${RAW_PAIRS_PATH}.`);
}

async function readRawPairs() {
  try {
    const parsed = JSON.parse(await readFile(RAW_PAIRS_PATH, "utf8")) as SerializableRawPair[];

    return parsed.map((pair) => ({
      entangledPairAddress: pair.entangledPairAddress,
      tokenAMint: pair.tokenAMint,
      tokenBMint: pair.tokenBMint,
      accountData: Buffer.from(pair.accountDataBase64, "base64")
    }));
  } catch {
    return null;
  }
}

async function precursorCandidatesFromExistingPairsJson(rawPairs: RawPair[]) {
  const candidates = new Set(rawPairs.map((pair) => pair.tokenAMint));

  try {
    const parsed = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as ProvenanceRecord[] | ProvenanceData;
    const existing = Array.isArray(parsed) ? parsed : parsed.originalTokens;

    for (const record of existing) {
      if (record.tokenA?.mint && record.tokenA.type === "true_fungible") {
        candidates.add(record.tokenA.mint);
      }
    }
  } catch {
    // Existing data is optional; raw Entangler pairs are sufficient for a preview run.
  }

  try {
    const cached = JSON.parse(await readFile(TOKEN_A_CACHE_PATH, "utf8")) as TokenA[];

    for (const tokenA of cached) {
      if (tokenA?.mint && tokenA.type === "true_fungible") {
        candidates.add(tokenA.mint);
      }
    }
  } catch {
    // The cache is optional, but useful when pairs.json needs to be regenerated.
  }

  return candidates;
}

async function readMintSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(MINT_SNAPSHOT_PATH, "utf8")) as unknown;

    if (!Array.isArray(parsed)) {
      console.warn(`${MINT_SNAPSHOT_PATH} exists but is not an array.`);
      return [];
    }

    return dedupe(parsed.filter((mint): mint is string => typeof mint === "string"));
  } catch {
    return [];
  }
}

async function readExistingTokenARecords() {
  const records = new Map<string, TokenA>();

  try {
    const parsed = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as ProvenanceRecord[] | ProvenanceData;
    const existing = Array.isArray(parsed) ? parsed : parsed.originalTokens;

    for (const record of existing) {
      if (record.tokenA?.mint) {
        records.set(record.tokenA.mint, record.tokenA);
      }
    }

    if (!Array.isArray(parsed)) {
      for (const record of parsed.nfts) {
        if (record.tokenA?.mint) {
          records.set(record.tokenA.mint, record.tokenA);
        }
      }
    }
  } catch {
    // Existing enrichment is an optimization only.
  }

  try {
    const cached = JSON.parse(await readFile(TOKEN_A_CACHE_PATH, "utf8")) as TokenA[];

    for (const tokenA of cached) {
      if (tokenA?.mint) {
        records.set(tokenA.mint, tokenA);
      }
    }
  } catch {
    // The cache is created by long enrichment runs and is optional.
  }

  return records;
}

async function writeTokenACache(records: Map<string, TokenA>) {
  await writeJsonFileAtomic(TOKEN_A_CACHE_PATH, [...records.values()]);
}

async function getPairsForMintB(mintB: string, layout: Layout): Promise<RawPair[]> {
  const accounts = await withRetry(() =>
    connection.getProgramAccounts(entanglerProgram, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode(entangledPairDiscriminator)
          }
        },
        {
          memcmp: {
            offset: layout.mintBOffset,
            bytes: mintB
          }
        }
      ]
    })
  );

  return accounts.map(({ pubkey, account }) => {
    const data = Buffer.from(account.data);
    return {
      entangledPairAddress: pubkey.toBase58(),
      tokenAMint: readPubkey(data, layout.mintAOffset),
      tokenBMint: readPubkey(data, layout.mintBOffset),
      accountData: data
    };
  });
}

async function discoverTeamWalletPrecursors() {
  const candidates = new Set<string>();
  let before: TransactionSignature | undefined;
  let pages = 0;

  while (true) {
    pages += 1;
    const signatures = await withRetry(() =>
      connection.getSignaturesForAddress(teamWallet, {
        before,
        limit: 1000
      })
    );

    if (signatures.length === 0) {
      break;
    }

    console.log(`Team wallet signature page ${pages}: ${signatures.length} signatures.`);

    const txs = await mapLimit(signatures, REQUEST_BATCH_SIZE, async (signatureInfo) => {
      const tx = await withRetry(() =>
        connection.getParsedTransaction(signatureInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0
        })
      );
      return tx;
    });

    for (const tx of txs) {
      for (const mint of initializedMintsFromTransaction(tx)) {
        const mintInfo = await getMintInfo(mint);

        if (mintInfo && mintInfo.decimals > 0) {
          candidates.add(mint);
        }
      }
    }

    const oldest = signatures[signatures.length - 1];

    if (!oldest || (typeof oldest.blockTime === "number" && oldest.blockTime <= EARLY_2021_UNIX)) {
      break;
    }

    if (MAX_TEAM_SIGNATURE_PAGES > 0 && pages >= MAX_TEAM_SIGNATURE_PAGES) {
      console.warn(`Stopped team wallet scan after MAX_TEAM_SIGNATURE_PAGES=${MAX_TEAM_SIGNATURE_PAGES}.`);
      break;
    }

    before = oldest.signature;
  }

  return candidates;
}

function initializedMintsFromTransaction(
  tx: Awaited<ReturnType<typeof connection.getParsedTransaction>>
) {
  const mints = new Set<string>();

  if (!tx?.transaction.message.instructions) {
    return [];
  }

  for (const instruction of tx.transaction.message.instructions) {
    if (!("parsed" in instruction)) {
      continue;
    }

    const parsed = instruction as ParsedInstruction;

    if (parsed.program === "spl-token" && parsed.parsed?.type === "initializeMint") {
      const mint = parsed.parsed.info?.mint;

      if (typeof mint === "string") {
        mints.add(mint);
      }
    }
  }

  return [...mints];
}

async function enrichRecords(rawPairs: RawPair[], precursorCandidates: Set<string>, snapshotMints: string[]): Promise<ProvenanceData> {
  const rawPairsByTokenA = new Map<string, RawPair[]>();

  for (const pair of rawPairs) {
    const list = rawPairsByTokenA.get(pair.tokenAMint) ?? [];
    list.push(pair);
    rawPairsByTokenA.set(pair.tokenAMint, list);
  }

  const tokenAMints = dedupe([...precursorCandidates, ...rawPairs.map((pair) => pair.tokenAMint), ...snapshotMints]);
  const metadataMints = dedupe([...tokenAMints, ...rawPairs.map((pair) => pair.tokenBMint)]);
  const pairedTokenACount = [...rawPairsByTokenA.values()].filter((pairs) => pairs.length > 0).length;
  console.log(
    `Grouped ${rawPairs.length} raw NFT pair links under ${pairedTokenACount} paired Token A mints; ${tokenAMints.length} mint records need token-account classification.`
  );
  const tokenARecords = await readExistingTokenARecords();

  const tokenAMintsToEnrich = tokenAMints.filter((mint) => {
    const existing = tokenARecords.get(mint);
    return shouldEnrichTokenA(existing);
  });

  if (tokenARecords.size > 0) {
    console.log(`Reusing ${tokenARecords.size} existing Token A enrichment records from ${OUTPUT_PATH}.`);
  }

  await mapLimit(tokenAMintsToEnrich, REQUEST_BATCH_SIZE, async (mint, index) => {
    console.log(`Enriching Token A ${index + 1}/${tokenAMintsToEnrich.length}: ${mint}`);
    const existing = tokenARecords.get(mint);
    const tokenA =
      existing && ENRICH_MINT_DATES && !FORCE_TOKEN_A_ENRICHMENT
        ? {
            ...existing,
            mintedAt: await getMintDateCached(mint)
          }
        : existing && FORCE_TOKEN_A_ENRICHMENT
          ? await backfillTokenA(existing, FAST_TOKEN_A_ENRICHMENT)
          : await enrichTokenA(mint, FAST_TOKEN_A_ENRICHMENT);
    tokenARecords.set(mint, tokenA);

    if ((index + 1) % 25 === 0 || index === tokenAMintsToEnrich.length - 1) {
      await writeTokenACache(tokenARecords);
      console.log(`Saved Token A enrichment cache (${index + 1}/${tokenAMintsToEnrich.length}).`);
    }
  });

  const tokenAAssets = new Map<string, DasAsset>();
  const tokenAAssetBatches = chunk(metadataMints, 100);
  let validTokenACount = 0;
  let invalidTokenACount = 0;

  await mapLimit(tokenAAssetBatches, Math.min(REQUEST_BATCH_SIZE, 4), async (mints, index) => {
    console.log(`Fetching Token A metadata batch ${index + 1}/${tokenAAssetBatches.length}: ${mints.length} mints`);
    const assets = await getAssetBatch(mints);

    for (const asset of assets) {
      if (asset) {
        tokenAAssets.set(asset.id, asset);
      }
    }
  });

  for (const mint of tokenAMints) {
    const tokenA = tokenARecords.get(mint);

    if (!tokenA) {
      continue;
    }

    const metadata = tokenAMetadataFromAsset(tokenAAssets.get(mint));
    const updated = {
      ...tokenA,
      metadata
    };

    tokenARecords.set(mint, updated);

    if (metadata.validOriginal) {
      validTokenACount += 1;
    } else {
      invalidTokenACount += 1;
    }
  }

  await writeTokenACache(tokenARecords);
  console.log(
    `Metadata validation: ${validTokenACount} valid Solarian mints; ${invalidTokenACount} skipped non-Solarian mints.`
  );

  const validOriginalMints = tokenAMints.filter((mint) => {
    const tokenA = tokenARecords.get(mint);
    return tokenA?.type === "true_fungible" && tokenA.metadata?.validOriginal;
  });
  const validNftMints = dedupe([
    ...rawPairs.map((pair) => pair.tokenBMint),
    ...tokenAMints.filter((mint) => {
      const tokenA = tokenARecords.get(mint);
      return tokenA?.type === "nft_like" && tokenA.metadata?.validOriginal;
    })
  ]);

  console.log(
    `Classified ${validOriginalMints.length} valid original FTs and ${validNftMints.length} valid NFT-like collection mints.`
  );

  const enrichedLinks = await mapLimit(rawPairs, REQUEST_BATCH_SIZE, async (pair) => {
    const tokenA = tokenARecords.get(pair.tokenAMint) ?? null;
    const asset = tokenAAssets.get(pair.tokenBMint);
    let tokenB = enrichTokenB(pair.tokenBMint, asset);

    tokenB = await withTokenBMintDate(tokenB);

    const swapped = await isPairSwapped(pair, tokenB);

    return {
      entangledPairAddress: pair.entangledPairAddress,
      tokenAMint: pair.tokenAMint,
      tokenBMint: pair.tokenBMint,
      tokenA,
      tokenB,
      swapped
    };
  });
  const linksByTokenA = groupLinksByMint(enrichedLinks, "tokenAMint");
  const linksByTokenB = new Map(enrichedLinks.map((link) => [link.tokenBMint, link]));

  const originalTokens: OriginalTokenRecord[] = [];
  for (const mint of validOriginalMints) {
    const tokenA = tokenARecords.get(mint);

    if (!tokenA) {
      continue;
    }

    const enrichedPairs = (linksByTokenA.get(mint) ?? []).map((link) => ({
      entangledPairAddress: link.entangledPairAddress,
      tokenB: link.tokenB,
      swapped: link.swapped
    }));

    enrichedPairs.sort((a, b) => (a.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER) - (b.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER));

    originalTokens.push({
      tokenA,
      pairs: enrichedPairs
    });
  }

  originalTokens.sort((a, b) => {
    const firstA = a.pairs[0]?.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER;
    const firstB = b.pairs[0]?.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER;
    return firstA - firstB || a.tokenA.mint.localeCompare(b.tokenA.mint);
  });

  const nfts: NftRecord[] = [];
  for (const mint of validNftMints) {
    const link = linksByTokenB.get(mint);
    let tokenB = link?.tokenB ?? enrichTokenB(mint, tokenAAssets.get(mint));

    tokenB = await withTokenBMintDate(tokenB, tokenARecords.get(mint)?.mintedAt);

    if (!link && !isCompleteDirectNft(tokenB)) {
      continue;
    }

    nfts.push({
      tokenB,
      tokenA: link?.tokenA ?? (link ? tokenARecords.get(link.tokenAMint) ?? null : null),
      entangledPairAddress: link?.entangledPairAddress ?? null,
      swapped: link?.swapped ?? false
    });
  }

  nfts.sort((a, b) => {
    const firstA = a.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER;
    const firstB = b.tokenB.mintNumber ?? Number.MAX_SAFE_INTEGER;
    return firstA - firstB || a.tokenB.mint.localeCompare(b.tokenB.mint);
  });

  return {
    originalTokens,
    nfts
  };
}

function isCompleteDirectNft(tokenB: TokenB) {
  return Boolean(tokenB.image && tokenB.mintNumber !== null && Object.keys(tokenB.attributes ?? {}).length > 0);
}

function groupLinksByMint(links: EnrichedPairLink[], key: "tokenAMint" | "tokenBMint") {
  const grouped = new Map<string, EnrichedPairLink[]>();

  for (const link of links) {
    const mint = link[key];
    const list = grouped.get(mint) ?? [];
    list.push(link);
    grouped.set(mint, list);
  }

  return grouped;
}

async function withTokenBMintDate(tokenB: TokenB, fallback?: string | null): Promise<TokenB> {
  if (tokenB.mintedAt) {
    return tokenB;
  }

  const cached = await getKnownMintDate(tokenB.mint);
  const mintedAt = cached ?? fallback ?? (ENRICH_MINT_DATES ? await getMintDateCached(tokenB.mint) : null);

  return {
    ...tokenB,
    mintedAt
  };
}

async function getKnownMintDate(mint: string) {
  const cache = await readMintDateCache();
  return cache.get(mint) ?? null;
}

function shouldEnrichTokenA(existing?: TokenA) {
  if (!existing) {
    return true;
  }

  if (ENRICH_MINT_DATES && !existing.mintedAt) {
    return true;
  }

  if (!FORCE_TOKEN_A_ENRICHMENT) {
    return false;
  }

  return existing.originalRecipients.length === 0 || existing.currentHolders.length === 0;
}

async function enrichTokenA(mint: string, fast = false): Promise<TokenA> {
  const mintInfo = await getMintInfo(mint);
  const isTrueFungible = (mintInfo?.decimals ?? 0) > 0;
  const mintedAt = ENRICH_MINT_DATES ? await getMintDateCached(mint) : null;

  if (fast) {
    return {
      mint,
      type: isTrueFungible ? "true_fungible" : "nft_like",
      decimals: mintInfo?.decimals ?? 0,
      supply: mintInfo?.supply ?? "0",
      minter: mintInfo?.mintAuthority ?? null,
      mintedAt,
      originalRecipients: [],
      currentHolders: []
    };
  }

  const [originalRecipients, currentHolders] = await Promise.all([
    getOriginalRecipients(mint, isTrueFungible),
    getCurrentHolders(mint)
  ]);

  return {
    mint,
    type: isTrueFungible ? "true_fungible" : "nft_like",
    decimals: mintInfo?.decimals ?? 0,
    supply: mintInfo?.supply ?? "0",
    minter: mintInfo?.mintAuthority ?? null,
    mintedAt,
    originalRecipients,
    currentHolders
  };
}

async function backfillTokenA(existing: TokenA, fast = false): Promise<TokenA> {
  if (fast) {
    return {
      ...existing,
      mintedAt: ENRICH_MINT_DATES && !existing.mintedAt ? await getMintDateCached(existing.mint) : existing.mintedAt
    };
  }

  const isTrueFungible = existing.type === "true_fungible";
  const [originalRecipients, currentHolders] = await Promise.all([
    existing.originalRecipients.length > 0 ? existing.originalRecipients : getOriginalRecipients(existing.mint, isTrueFungible),
    existing.currentHolders.length > 0 ? existing.currentHolders : getCurrentHolders(existing.mint)
  ]);

  return {
    ...existing,
    mintedAt: ENRICH_MINT_DATES && !existing.mintedAt ? await getMintDateCached(existing.mint) : existing.mintedAt,
    originalRecipients,
    currentHolders
  };
}

async function getMintDate(mint: string) {
  let before: TransactionSignature | undefined;
  let oldestBlockTime: number | null | undefined;

  while (true) {
    const page = await withRetry(() =>
      connection.getSignaturesForAddress(new PublicKey(mint), {
        before,
        limit: 1000
      })
    );

    if (page.length === 0) {
      break;
    }

    const oldest = page[page.length - 1];
    oldestBlockTime = oldest.blockTime;

    if (page.length < 1000) {
      break;
    }

    before = oldest.signature;
  }

  return typeof oldestBlockTime === "number" ? new Date(oldestBlockTime * 1000).toISOString() : null;
}

async function getMintDateCached(mint: string) {
  const cache = await readMintDateCache();

  if (cache.has(mint)) {
    return cache.get(mint) ?? null;
  }

  const mintedAt = await getMintDate(mint);
  cache.set(mint, mintedAt);
  await writeMintDateCache(cache);
  return mintedAt;
}

async function readMintDateCache() {
  if (mintDateCache) {
    return mintDateCache;
  }

  try {
    const parsed = JSON.parse(await readFile(MINT_DATE_CACHE_PATH, "utf8")) as Record<string, string | null>;
    mintDateCache = new Map(Object.entries(parsed));
  } catch {
    mintDateCache = new Map();
  }

  return mintDateCache;
}

async function writeMintDateCache(cache: Map<string, string | null>) {
  await writeJsonFileAtomic(MINT_DATE_CACHE_PATH, Object.fromEntries(cache));
}

async function writeJsonFileAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, filePath);
}

async function getMintInfo(mint: string) {
  const account = await withRetry(() => connection.getParsedAccountInfo(new PublicKey(mint), "confirmed"));
  const data = account.value?.data;

  if (!data || typeof data === "string" || !("parsed" in data)) {
    return null;
  }

  const parsed = data as ParsedAccountData;
  const info = parsed.parsed?.info;

  if (!info || typeof info.decimals !== "number") {
    return null;
  }

  return {
    decimals: info.decimals as number,
    supply: String(info.supply ?? "0"),
    mintAuthority: typeof info.mintAuthority === "string" ? info.mintAuthority : null
  };
}

async function getOriginalRecipients(mint: string, collectMultiple: boolean) {
  const signatures: TransactionSignature[] = [];
  let before: TransactionSignature | undefined;

  while (true) {
    const page = await withRetry(() =>
      connection.getSignaturesForAddress(new PublicKey(mint), {
        before,
        limit: 1000
      })
    );

    if (page.length === 0) {
      break;
    }

    signatures.push(...page.map((item) => item.signature));

    if (page.length < 1000) {
      break;
    }

    before = page[page.length - 1].signature;
  }

  const earliest = signatures.slice(collectMultiple ? -100 : -25).reverse();
  const recipients = new Set<string>();

  for (const signature of earliest) {
    const tx = await withRetry(() =>
      connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      })
    );
    const destinations = mintToDestinations(tx, mint);

    for (const owner of tokenBalanceOwnersForDestinations(tx, mint, destinations)) {
      recipients.add(owner);
    }

    for (const destination of destinations) {
      const owner = await tokenAccountOwner(destination);

      if (owner) {
        recipients.add(owner);
      }
    }

    if (recipients.size > 0 && !collectMultiple) {
      break;
    }
  }

  return [...recipients];
}

function tokenBalanceOwnersForDestinations(
  tx: Awaited<ReturnType<typeof connection.getParsedTransaction>>,
  mint: string,
  destinations: string[]
) {
  const destinationSet = new Set(destinations);
  const owners = new Set<string>();
  const accountKeys = tx?.transaction.message.accountKeys ?? [];
  const postTokenBalances = tx?.meta?.postTokenBalances ?? [];

  for (const balance of postTokenBalances) {
    if (balance.mint !== mint || typeof balance.owner !== "string") {
      continue;
    }

    const tokenAccount = accountKeyToString(accountKeys[balance.accountIndex]);

    if (!destinationSet.size || destinationSet.has(tokenAccount)) {
      owners.add(balance.owner);
    }
  }

  return [...owners];
}

function accountKeyToString(accountKey: unknown) {
  if (typeof accountKey === "string") {
    return accountKey;
  }

  if (accountKey && typeof accountKey === "object") {
    if ("pubkey" in accountKey) {
      return String(accountKey.pubkey);
    }

    if ("toBase58" in accountKey && typeof accountKey.toBase58 === "function") {
      return accountKey.toBase58();
    }
  }

  return String(accountKey ?? "");
}

function mintToDestinations(tx: Awaited<ReturnType<typeof connection.getParsedTransaction>>, mint: string) {
  const destinations = new Set<string>();
  const instructions = [
    ...(tx?.transaction.message.instructions ?? []),
    ...(tx?.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions)
  ];

  for (const instruction of instructions) {
    if (!("parsed" in instruction)) {
      continue;
    }

    const parsed = instruction as ParsedInstruction;
    const info = parsed.parsed?.info;

    if (
      parsed.program === "spl-token" &&
      (parsed.parsed?.type === "mintTo" || parsed.parsed?.type === "mintToChecked") &&
      info?.mint === mint &&
      typeof info.destination === "string"
    ) {
      destinations.add(info.destination);
    }
  }

  return [...destinations];
}

async function getCurrentHolders(mint: string): Promise<Holder[]> {
  const largest = await withRetry(() => connection.getTokenLargestAccounts(new PublicKey(mint), "confirmed"));
  const nonZero = largest.value.filter((account) => Number(account.uiAmountString ?? account.amount) > 0);

  return mapLimit(nonZero, REQUEST_BATCH_SIZE, async (account) => {
    const owner = await tokenAccountOwner(account.address.toBase58());
    const ownerAddress = owner ?? account.address.toBase58();

    return {
      owner: ownerAddress,
      tokenAccount: account.address.toBase58(),
      amount: account.amount,
      uiAmount: account.uiAmount,
      teamHeld: ownerAddress === TEAM_WALLET
    };
  });
}

async function tokenAccountOwner(tokenAccount: string) {
  const account = await withRetry(() => connection.getParsedAccountInfo(new PublicKey(tokenAccount), "confirmed"));
  const data = account.value?.data;

  if (!data || typeof data === "string" || !("parsed" in data)) {
    return null;
  }

  const parsed = data as ParsedAccountData;
  const owner = parsed.parsed?.info?.owner;
  return typeof owner === "string" ? owner : null;
}

async function getAsset(mint: string) {
  try {
    return await heliusRpc<DasAsset>("getAsset", {
      id: mint
    });
  } catch (error) {
    console.warn(`Failed to fetch DAS asset ${mint}: ${error}`);
    return undefined;
  }
}

async function getAssetBatch(mints: string[]) {
  try {
    return await heliusRpc<DasAsset[]>("getAssetBatch", {
      ids: mints
    });
  } catch (error) {
    console.warn(`Failed to fetch DAS asset batch; falling back to individual getAsset calls: ${error}`);
    return mapLimit(mints, REQUEST_BATCH_SIZE, (mint) => getAsset(mint));
  }
}

function enrichTokenB(mint: string, asset?: DasAsset): TokenB {
  const metadata = asset?.content?.metadata;
  const attributes = normalizeAttributes(metadata?.attributes);
  const symbol = metadata?.symbol;

  return {
    mint,
    name: metadata?.name ?? "",
    symbol,
    mintNumber: parseMintNumber(symbol, attributes),
    image: asset?.content?.links?.image ?? asset?.content?.files?.find((file) => file.uri)?.uri ?? null,
    currentOwner: asset?.ownership?.owner ?? null,
    mintedAt: asset?.created_at ?? asset?.createdAt ?? null,
    attributes
  };
}

function tokenAMetadataFromAsset(asset?: DasAsset): TokenAMetadata {
  const metadata = asset?.content?.metadata;
  const name = metadata?.name?.trim() || null;
  const symbol = metadata?.symbol?.trim() || null;
  const verifiedTeamCreator =
    asset?.creators?.some((creator) => creator.address === TEAM_WALLET && creator.verified === true) ?? false;
  const validOriginal = name === "Solarian" && symbol === "SLR" && verifiedTeamCreator;

  return {
    name,
    symbol,
    description: metadata?.description ?? null,
    image: asset?.content?.links?.image ?? asset?.content?.files?.find((file) => file.uri)?.uri ?? null,
    verifiedTeamCreator,
    validOriginal
  };
}

async function isPairSwapped(pair: RawPair, tokenB: TokenB) {
  if (FAST_SWAP_STATUS) {
    return tokenB.currentOwner !== null;
  }

  const tokenBVault = readPubkey(pair.accountData, 136);
  const vaultBalance = await tokenAccountBalanceForMint(tokenBVault, tokenB.mint);

  if (vaultBalance) {
    return BigInt(vaultBalance.amount) === 0n;
  }

  return tokenB.currentOwner !== null;
}

async function tokenAccountBalanceForMint(tokenAccount: string, mint: string): Promise<TokenAmount | null> {
  const account = await withRetry(() => connection.getParsedAccountInfo(new PublicKey(tokenAccount), "confirmed"));
  const data = account.value?.data;

  if (!data || typeof data === "string" || !("parsed" in data)) {
    return null;
  }

  const parsed = data as ParsedAccountData;
  const info = parsed.parsed?.info;

  if (parsed.program !== "spl-token" || info?.mint !== mint) {
    return null;
  }

  return info.tokenAmount ?? null;
}

function normalizeAttributes(attributes: DasAttribute[] | undefined) {
  const normalized: Record<string, string | number | boolean | null> = {};

  if (!Array.isArray(attributes)) {
    return normalized;
  }

  for (const attribute of attributes) {
    const key = attribute.trait_type;

    if (key) {
      normalized[key] = attribute.value ?? null;
    }
  }

  return normalized;
}

function parseMintNumber(symbol?: string, attributes?: Record<string, string | number | boolean | null>) {
  const symbolMatch = symbol?.match(/SLR0*(\d+)/i);

  if (symbolMatch) {
    return Number(symbolMatch[1]);
  }

  const mintAttribute = Object.entries(attributes ?? {}).find(([key]) => key.toLowerCase() === "mint #");
  const parsed = Number(mintAttribute?.[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function heliusRpc<T>(method: string, params: unknown) {
  return withRetry(async () => {
    const response = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${method}-${Date.now()}`,
        method,
        params
      })
    });

    if (response.status === 429) {
      throw new RateLimitError("Helius returned HTTP 429.");
    }

    if (!response.ok) {
      throw new Error(`Helius HTTP ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { result?: T; error?: { message?: string } };

    if (json.error) {
      throw new Error(json.error.message ?? `Helius ${method} returned an error.`);
    }

    return json.result as T;
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String(error);
      const retryable = error instanceof RateLimitError || /429|rate|timeout|fetch failed|ECONNRESET/i.test(message);

      if (!retryable || attempt === maxAttempts - 1) {
        break;
      }

      const delay = Math.min(30_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 300);
      console.warn(`Retrying after ${delay}ms: ${message}`);
      await sleep(delay);
    }
  }

  throw lastError;
}

class RateLimitError extends Error {}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function dedupe<T>(items: T[]) {
  return [...new Set(items)];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function mapLimit<T, U>(items: T[], limit: number, fn: (item: T, index: number) => Promise<U>) {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
