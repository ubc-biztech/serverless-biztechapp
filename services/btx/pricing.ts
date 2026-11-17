import {
  IPO_VALUATION_MAX,
  IPO_VALUATION_MIN,
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
  if (project.seedSharesAtIpo == null)
    return ipoStockPrice(project.netShares ?? 0);
  return project.currentPrice ?? ipoStockPrice(project.seedSharesAtIpo);
}

// Share quantity is positive for both sides; only the cash change is signed.
export function costQuote(side: "BUY" | "SELL", shares: number, price: number) {
  const notional = roundMoney(shares * price);
  const charge = roundMoney((notional * TRANSACTION_FEE_BPS) / 10000);

  return {
    fee: charge,
    cashDelta:
      side === "BUY"
        ? roundMoney(-notional - charge)
        : roundMoney(notional - charge)
  };
}

export function seedTradeQuote(
  project: BtxProject,
  ipoAt: number | null,
  now: number,
  side: "BUY" | "SELL",
  quantity: number
) {
  const shares = quantity;
  if (shares <= 0) throw new BtxError(400, "shares must be positive");
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
  throw new BtxError(503, "Live execution quotes are not available yet");
}
