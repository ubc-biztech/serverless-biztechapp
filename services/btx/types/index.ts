export const TradeStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  FILLED: "FILLED",
  REJECTED: "REJECTED"
} as const;

export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

export type SeedStatus = "NOT_STARTED" | "ACTIVE" | "ENDED" | "LIVE";

/** HLD config row — omit eventId so it stays off byEvent. */
export interface BtxEventConfig {
  projectId: string;
  ipoAt: number | null;
}

export interface BtxProject {
  projectId: string;
  eventId: string;
  companyName?: string;
  blurb?: string;
  youtubeURL?: string;
  ticker?: string;
  name?: string;
  description?: string;
  basePrice?: number;
  currentPrice?: number;
  netShares?: number;
  seedStartedAt?: number | null;
  seedEndsAt?: number | null;
  seedSharesAtIpo?: number | null;
  version?: number;
  lastPriceTs?: number;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface BtxEventAccount {
  userId: string;
  eventId: string;
  cashBalance: number;
  totalAllocated: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface BtxHolding {
  userId: string;
  projectId: string;
  shares: number;
  avgPrice?: number;
  costBasis?: number;
}

export interface BtxTrade {
  projectId: string;
  tradeId: string;
  userId: string;
  side: "BUY" | "SELL";
  shares: number;
  price?: number;
  status?: TradeStatus;
  createdAt?: number;
  [key: string]: unknown;
}

export interface BtxPricePoint {
  projectId: string;
  ts: number;
  price: number;
  source?: string;
}

export type BtxErrorCode =
  | "FORBIDDEN"
  | "SEED_NOT_STARTED"
  | "SEED_WINDOW_ENDED"
  | "SELL_NOT_AVAILABLE_BEFORE_IPO"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SHARES"
  | "TRANSITION_UNAVAILABLE"
  | "INVALID_TRADE_ID"
  | "EVENT_ENDED"
  | "VALIDATION_ERROR";
