import {
  IPO_VALUATION_MAX_CENTS,
  IPO_VALUATION_MIN_CENTS,
  LIVE_IMPACT_BPS_PER_SHARE,
  MIN_PRICE_CENTS,
  SEED_PRICE_CENTS,
  SEED_TARGET_SHARES,
  TRANSACTION_FEE_BPS
} from "./constants";
import { BtxError } from "./helpers";
import type { BtxProject, SeedStatus } from "./types";

export function ipoStockPriceCents(seedShares: number) {
  const demand = Math.min(seedShares / SEED_TARGET_SHARES, 1);
  return Math.round(
    (SEED_PRICE_CENTS *
      (IPO_VALUATION_MIN_CENTS + demand * (IPO_VALUATION_MAX_CENTS - IPO_VALUATION_MIN_CENTS))) /
      IPO_VALUATION_MIN_CENTS
  );
}

export function seedStatus(
  project: Pick<BtxProject, "seedStartedAt" | "seedEndsAt">,
  ipoAt: number | null,
  now: number
): SeedStatus {
  if (ipoAt != null) return "LIVE";
  if (
    project.seedStartedAt == null ||
    project.seedEndsAt == null ||
    now < project.seedStartedAt
  )
    return "NOT_STARTED";
  return now < project.seedEndsAt ? "ACTIVE" : "ENDED";
}

export function stockPriceCents(project: BtxProject, ipoAt: number | null) {
  if (ipoAt == null) return SEED_PRICE_CENTS;
  return project.currentPriceCents;
}

export function validateShares(shares: number) {
  if (!Number.isSafeInteger(shares) || shares <= 0) {
    throw new BtxError(400, "shares must be a positive safe integer", {
      code: "VALIDATION_ERROR"
    });
  }
}

// Share quantity is positive for both sides; only the cash change is signed.
export function costQuote(side: "BUY" | "SELL", shares: number, priceCents: number) {
  const notionalCents = shares * priceCents;
  const feeCents = Math.round((notionalCents * TRANSACTION_FEE_BPS) / 10_000);
  const cashDeltaCents = side === "SELL" ? notionalCents - feeCents : -notionalCents - feeCents;
  
  return { feeCents, cashDeltaCents };
}

export function tradeQuote(
  project: BtxProject,
  ipoAt: number | null,
  now: number,
  side: "BUY" | "SELL",
  shares: number
) {
  validateShares(shares);
  if (ipoAt == null) {
    const status = seedStatus(project, ipoAt, now);
    if (side === "SELL")
      throw new BtxError(409, "Selling blocked before IPO", {
        code: "SELL_NOT_AVAILABLE_BEFORE_IPO"
      });
    if (status !== "ACTIVE")
      throw new BtxError(409, "Seed window is not active", {
        code:
          status === "NOT_STARTED" ? "SEED_NOT_STARTED" : "SEED_WINDOW_ENDED"
      });
    return {
      priceCents: SEED_PRICE_CENTS,
      endPriceCents: SEED_PRICE_CENTS,
      ...costQuote(side, shares, SEED_PRICE_CENTS)
    };
  }
  const priceCents = stockPriceCents(project, ipoAt);
  const priceChange = (priceCents * shares * LIVE_IMPACT_BPS_PER_SHARE) / 10_000;
  const end = side === "SELL" ? priceCents - priceChange : priceCents + priceChange;
  // All shares execute at the current price; price impact applies after the order.
  return {
    priceCents,
    endPriceCents: Math.round(Math.max(MIN_PRICE_CENTS, end)),
    ...costQuote(side, shares, priceCents)
  };
}
