// KickStart HLD pricing (monetary amounts are in cents).

/** Fresh event-account allocation. */
export const KICKSTART_INITIAL_CASH_CENTS = 50_000 * 100;

/** Fixed BUY price during seeding. */
export const SEED_PRICE_CENTS = 100 * 100;

/** How long a quote remains valid. */
export const QUOTE_WINDOW_MS = 0.5 * 60 * 1000;

/** Live-market price floor. */
export const MIN_PRICE_CENTS = 0.10 * 100;

/** 2% fee on BUY and SELL (basis points). */
export const TRANSACTION_FEE_BPS = 200;

/** Live demand impact: 5 bps of price per share traded. */
export const LIVE_IMPACT_BPS_PER_SHARE = 5;

/** Target seed float used for IPO opening-price calc. */
export const SEED_TARGET_SHARES = 5000;

export const IPO_VALUATION_MIN_CENTS = 1_000_000 * 100;
export const IPO_VALUATION_MAX_CENTS = 10_000_000 * 100;

/** Scheduled minute noise bound. */
export const NOISE_MAX_PCT = 0.01;
