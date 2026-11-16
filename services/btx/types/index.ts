export const EventPhase = {
  PRE_IPO: "PRE_IPO",
  IPO_PREPARING: "IPO_PREPARING",
  LIVE: "LIVE"
} as const;

export type EventPhase = (typeof EventPhase)[keyof typeof EventPhase];

export const TradeStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  FILLED: "FILLED",
  REJECTED: "REJECTED"
} as const;

export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

export interface BtxEnvelope<T> {
  message: string;
  data: T;
}

export interface BtxProject {
  projectId: string;
  eventId: string;
  ticker?: string;
  name?: string;
  description?: string;
  basePrice?: number;
  currentPrice?: number;
  netShares?: number;
  seedAmount?: number;
  seedStartedAt?: number;
  seedEndsAt?: number;
  seedSharesAtIpo?: number;
  version?: number;
  lastPriceTs?: number;
  lastNoiseInterval?: number;
  totalVolume?: number;
  totalTrades?: number;
  totalBuyShares?: number;
  totalSellShares?: number;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
  randomDriftAt?: number;
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
  createdAt?: number;
  updatedAt?: number;
}

export interface BtxTrade {
  projectId: string;
  tradeId: string;
  userId: string;
  eventId?: string;
  side: "BUY" | "SELL";
  shares: number;
  price?: number;
  cashDelta?: number;
  status?: TradeStatus;
  createdAt?: number;
  [key: string]: unknown;
}

export interface BtxSocketConnection {
  connectionId: string;
  eventId: string;
  userId: string;
  connectedAt?: number;
}

export interface BtxPricePoint {
  projectId: string;
  ts: number;
  price: number;
  eventId?: string;
  source?: string;
}

export type BtxErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SEED_NOT_STARTED"
  | "SEED_ENDED"
  | "SELLING_BEFORE_IPO"
  | "STALE_QUOTE"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SHARES"
  | "DUPLICATE_ID_MISMATCH"
  | "TRANSITION_UNAVAILABLE"
  | "CONCURRENCY_EXHAUSTED"
  | "INVALID_TRADE_ID"
  | "EVENT_ENDED"
  | "VALIDATION_ERROR";
