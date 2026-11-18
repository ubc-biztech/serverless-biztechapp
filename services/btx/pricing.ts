import {
  IPO_VALUATION_MAX,
  IPO_VALUATION_MIN,
  LIVE_IMPACT_BPS_PER_SHARE,
  MIN_PRICE,
  SEED_PRICE,
  SEED_TARGET_SHARES,
  TRANSACTION_FEE_BPS
} from "./constants";
import { BtxError, roundMoney } from "./helpers";
import type { BtxProject, SeedStatus } from "./types";

export function ipoStockPrice(seedShares: number) {
  const demand = Math.min(seedShares / SEED_TARGET_SHARES, 1);
  return roundMoney(
    (SEED_PRICE *
      (IPO_VALUATION_MIN + demand * (IPO_VALUATION_MAX - IPO_VALUATION_MIN))) /
      IPO_VALUATION_MIN
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

export function stockPrice(project: BtxProject, ipoAt: number | null) {
  if (ipoAt == null) return SEED_PRICE;
  return project.currentPrice!;
}

export function validateShares(shares: unknown) {
  if (!Number.isSafeInteger(shares) || shares <= 0) {
    throw new BtxError(400, "shares must be a positive safe integer", {
      code: "VALIDATION_ERROR"
    });
  }
}

// Share quantity is positive for both sides; only the cash change is signed.
export function costQuote(side: "BUY" | "SELL", shares: number, price: number) {
  const notional = roundMoney(shares * price);
  const charge = roundMoney((notional * TRANSACTION_FEE_BPS) / 10000);
  let cashDelta = -notional - charge;
  if (side === "SELL") cashDelta = notional - charge;

  return {
    fee: charge,
    cashDelta: roundMoney(cashDelta)
  };
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
      price: SEED_PRICE,
      endPrice: SEED_PRICE,
      ...costQuote(side, shares, SEED_PRICE)
    };
  }
  const start = stockPrice(project, ipoAt);
  let priceChange = (start * shares * LIVE_IMPACT_BPS_PER_SHARE) / 10000;
  if (side === "SELL") priceChange = -priceChange;
  const end = start + priceChange;
  // All shares execute at the current price; price impact applies after the order.
  const price = start;
  return {
    price,
    endPrice: roundMoney(Math.max(MIN_PRICE, end)),
    ...costQuote(side, shares, price)
  };
}
