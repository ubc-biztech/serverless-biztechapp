import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";

const { ipoStockPriceCents, tradeQuote } = await loadBtx('export * from "./pricing"');

const eventEndsAt = 3_600_100;
process.env.KICKSTART_EVENT_ENDS_AT = new Date(eventEndsAt).toISOString();
const listing = {
  currentPriceCents: 10_000, seedSharesAtIpo: 0, seedStartedAt: 100, seedEndsAt: 1_800_100
};

test("seed buys keep their fixed price after a legacy timer expires", () => {
  const buy = now => tradeQuote(listing, null, now, "BUY", 2);
  assert.throws(() => buy(99), { data: { code: "SEED_NOT_STARTED" } });
  assert.deepEqual(buy(100), {
    priceCents: 10_000, endPriceCents: 10_000, feeCents: 400, cashDeltaCents: -20_400
  });
  assert.deepEqual(buy(listing.seedEndsAt + 1), buy(100));
  assert.throws(() => buy(eventEndsAt), { data: { code: "SEED_WINDOW_ENDED" } });
});

test("participants cannot sell during the seed window", () => {
  assert.throws(() => tradeQuote(listing, null, 150, "SELL", 1), {
    statusCode: 409, data: { code: "SELL_NOT_AVAILABLE_BEFORE_IPO" }
  });
});

test("orders require a positive, safe whole-share quantity", () => {
  for (const shares of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    assert.throws(() => tradeQuote(listing, 1, 150, "BUY", shares), {
      statusCode: 400, data: { code: "VALIDATION_ERROR" }
    });
  }
});

test("IPO pricing scales with seed demand and caps at 5,000 shares", () => {
  assert.equal(ipoStockPriceCents(0), 10_000);
  assert.equal(ipoStockPriceCents(2500), 55_000);
  assert.equal(ipoStockPriceCents(5000), 100_000);
  assert.equal(ipoStockPriceCents(5001), 100_000);
});

test("buying and immediately selling the same shares costs both fees", () => {
  const buy = tradeQuote(listing, 1, 2, "BUY", 100);
  assert.equal(buy.priceCents, 10_250);
  assert.equal(buy.endPriceCents, 10_500);
  const sell = tradeQuote({ ...listing, currentPriceCents: buy.endPriceCents }, 1, 3, "SELL", 100);
  assert.equal(sell.priceCents, buy.priceCents);
  assert.equal(sell.endPriceCents, listing.currentPriceCents);
  assert.equal(buy.cashDeltaCents + sell.cashDeltaCents, -41_000);
});

test("a sell that crosses the price floor charges the floor for the remaining shares", () => {
  const sell = tradeQuote({ ...listing, currentPriceCents: 30 }, 1, 2, "SELL", 8);
  assert.deepEqual(sell, { priceCents: 15, endPriceCents: 10, feeCents: 2, cashDeltaCents: 118 });
});
