// services/btx/constants.js

export const DEFAULT_EVENT_ID = "kickstart";

// intial virtual cash allocation for any user who touches BTX for the first time
export const INITIAL_CASH_BALANCE = 1000;

// price behaviour
export const MIN_PRICE = 0.5;
export const DEFAULT_BASE_PRICE = 1.0;
export const PRICE_SENSITIVITY_PER_SHARE = 0.02; // how much price moves per net share
export const TRANSACTION_FEE_BPS = 200;
export const EQUILIBRIUM_SENSITIVITY_FACTOR = 0.7;
export const EXECUTION_NOISE_MAX_PCT = 0.01;

// Seed -> base price conversion
// basePrice = max(MIN_PRICE, DEFAULT_BASE_PRICE + seedAmount * SEED_TO_PRICE_FACTOR)
export const SEED_TO_PRICE_FACTOR = 0.1;

export const PHASE_BUMP_PRESETS = {
  KICKOFF_HYPE: 0.15,
  VALIDATION_GOOD: 0.1,
  VALIDATION_BAD: -0.05,
  MVP_SHIPPED: 0.3,
  USER_FEEDBACK_GOOD: 0.1,
  USER_FEEDBACK_BAD: -0.1,
  DEMO_QUALIFIER: 0.5,
  DEMO_WINNER: 1.0
};

export const ADMIN_EMAILS =
  process.env.BTX_ADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) ||
  [];

export const DRIFT_ENABLED = "true";

export const DRIFT_MAX_PCT_PER_TICK = 0.015;

export const DRIFT_MEAN_REVERSION = 0.12;
