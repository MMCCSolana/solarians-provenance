export type TokenAType = "true_fungible" | "nft_like";

export type Holder = {
  owner: string;
  tokenAccount?: string;
  amount?: string;
  uiAmount?: number | null;
  teamHeld?: boolean;
};

export type TokenAMetadata = {
  name: string | null;
  symbol: string | null;
  description?: string | null;
  image?: string | null;
  verifiedTeamCreator: boolean;
  validOriginal: boolean;
};

export type TokenA = {
  mint: string;
  type: TokenAType;
  decimals: number;
  supply: string;
  minter: string | null;
  mintedAt?: string | null;
  metadata?: TokenAMetadata;
  originalRecipients: string[];
  currentHolders: Holder[];
};

export type TokenB = {
  mint: string;
  name: string;
  symbol?: string;
  mintNumber: number | null;
  image: string | null;
  currentOwner: string | null;
  mintedAt?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
};

export type ProvenancePair = {
  entangledPairAddress: string;
  tokenB: TokenB;
  swapped: boolean;
};

export type OriginalTokenRecord = {
  tokenA: TokenA;
  pairs: ProvenancePair[];
};

export type NftRecord = {
  tokenB: TokenB;
  tokenA: TokenA | null;
  entangledPairAddress: string | null;
  swapped: boolean;
};

export type ProvenanceData = {
  originalTokens: OriginalTokenRecord[];
  nfts: NftRecord[];
};

export type ProvenanceRecord = OriginalTokenRecord;
