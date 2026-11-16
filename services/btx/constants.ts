// KickStart HLD pricing / accounting knobs (dollars unless noted).

/** Fresh event-account allocation. */
export const KICKSTART_INITIAL_CASH = 50000;

/** Fixed BUY price during the seed window. */
export const SEED_PRICE = 100;

/** Live-market price floor. */
export const MIN_PRICE = 0.1;

/** 2% fee on BUY and SELL (basis points). */
export const TRANSACTION_FEE_BPS = 200;

/** Live demand impact: 2 bps of price per share traded. */
export const LIVE_IMPACT_BPS_PER_SHARE = 2;

/** Target seed float used for IPO opening-price calc. */
export const SEED_TARGET_SHARES = 5000;

export const IPO_VALUATION_MIN = 1_000_000;
export const IPO_VALUATION_MAX = 10_000_000;

/** Scheduled minute noise bound (±1%). Wired in PR3. */
export const NOISE_MAX_PCT = 0.01;

/** Max optimistic-concurrency retries on a trade/tick. */
export const MAX_CONFLICT_RETRIES = 3;
