export const TradeStatus = {
  PENDING: "PENDING",
  FILLED: "FILLED",
  REJECTED: "REJECTED"
} as const;

export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

export type MarketCommand =
  | { type: "TRADE"; projectId: string; tradeId: string }
  | { type: "TICK"; projectId: string; scheduledTickTs: number }
  | { type: "IPO" };

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
  // Listing creation sets the seed price before seeding opens. IPO replaces it.
  currentPriceCents: number;
  netShares: number;
  seedStartedAt?: number | null;
  seedEndsAt?: number | null;
  seedSharesAtIpo?: number | null;
  lastPriceTs: number;
  lastScheduledTickTs?: number;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface BtxEventAccount {
  userId: string;
  eventId: string;
  cashBalanceCents: number;
  totalAllocatedCents: number;
  createdAt: number;
  updatedAt: number;
}

export interface BtxHolding {
  userId: string;
  projectId: string;
  shares: number;
  costBasisCents: number;
}

export interface BtxTrade {
  projectId: string;
  tradeId: string;
  userId: string;
  eventId: string;
  accountId: string;
  side: "BUY" | "SELL";
  shares: number;
  priceCents?: number;
  endPriceCents?: number; // Company price per share after the trade.
  feeCents?: number;
  cashDeltaCents?: number; // Cash change after fees. Negative for buys, positive for sells.
  realizedPnlCents?: number;
  status: TradeStatus;
  createdAt: number;
  /** Market phase when submitted; null means pre-IPO. */
  acceptedIpoAt: number | null;
  /** BUY: maximum execution price per share. SELL: minimum. Fees are separate. */
  limitPriceCents: number;
  result?: {
    shares: number;
    cashBalanceCents: number;
    costBasisCents: number;
  };
  rejection?: { code: BtxErrorCode; message: string };
  [key: string]: unknown;
}

export interface BtxPricePoint {
  projectId: string;
  ts: number;
  priceCents: number;
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
  | "STALE_QUOTE"
  | "LIMIT_PRICE_EXCEEDED"
  | "TRADE_REJECTED"
  | "VALIDATION_ERROR";
