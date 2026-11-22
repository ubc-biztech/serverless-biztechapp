import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";

const { db, tables, getQuote, applyGrant, getPortfolioForUser, processTrade, submitTrade } = await loadBtx(`
  export { default as db } from "../../lib/docClient.js";
  export * as tables from "./repos/tables";
  export { getQuote, applyGrant } from "./market";
  export { getPortfolioForUser } from "./repos/accounts";
  export { processTrade, submitTrade } from "./trades";
`);

const eventId = "test-event";
const projectId = eventId + ":listing";
const userId = "participant@example.org";
const tradeId = "order";
process.env.KICKSTART_EVENT_KEY = eventId;
process.env.KICKSTART_EVENT_ENDS_AT = new Date(100_000).toISOString();

// Supply rows at the DynamoDB boundary and capture the writes requested by each unit.
function market(t) {
  t.mock.method(Date, "now", () => 1000);
  const project = {
    projectId, eventId, seedSharesAtIpo: 0, currentPriceCents: 10_000,
    netShares: 10, lastPriceTs: 900, seedStartedAt: 100, seedEndsAt: 2000
  };
  const config = { ipoAt: 500 };
  const registration = { registrationStatus: "acceptedComplete" };
  const account = { userId, eventId, cashBalanceCents: 100_000, totalAllocatedCents: 120_000 };
  const holding = { userId, projectId, shares: 10, costBasisCents: 80_000 };
  const trade = {
    userId, projectId, tradeId, eventId, side: "SELL", shares: 4,
    limitPriceCents: 9800, status: "PENDING", acceptedIpoAt: 500
  };
  const projects = new Map([[projectId, project], ["config:" + eventId, config]]);
  const rows = {
    [tables.REGISTRATIONS_TABLE]: registration, [tables.EVENT_ACCOUNTS_TABLE]: account,
    [tables.HOLDINGS_TABLE]: holding, [tables.TRADES_TABLE]: trade
  };
  const histories = { [tables.HOLDINGS_TABLE]: [holding], [tables.TRADES_TABLE]: [], [tables.SOCKETS_TABLE]: [] };
  const writes = [];
  t.mock.method(db, "send", async command => {
    const { Key, TableName } = command.input;
    switch (command.constructor.name) {
      case "GetCommand":
        if (TableName === tables.PROJECTS_TABLE) return { Item: projects.get(Key.projectId) };
        assert.ok(Object.hasOwn(rows, TableName), "unexpected read of " + TableName);
        return { Item: rows[TableName] };
      case "QueryCommand":
        assert.ok(Object.hasOwn(histories, TableName), "unexpected query of " + TableName);
        return { Items: histories[TableName] };
      case "TransactWriteCommand":
      case "UpdateCommand":
      case "PutCommand":
        writes.push(command.input);
        return {};
      default:
        assert.fail("Unexpected command " + command.constructor.name);
    }
  });
  return { trade, config, registration, histories, projects, rows, writes };
}

test("a seed quote expires with the listing window and reserves no cash", async t => {
  const { config, writes } = market(t);
  config.ipoAt = null;
  const quote = await getQuote({ projectId, userId, side: "BUY", shares: 2 });
  assert.equal(quote.expiresAt, 2000);
  assert.equal(quote.totalCostCents, 20_400);
  assert.deepEqual(writes, []);
});

test("a participant cannot quote an order for their own team", async t => {
  const { registration } = market(t);
  registration.teamID = "listing";
  await assert.rejects(getQuote({ projectId, userId, side: "BUY", shares: 1 }), {
    statusCode: 403, data: { code: "FORBIDDEN" }
  });
});

test("submission records a pending order with its limit and quoted phase before any fill", async t => {
  const { rows, writes } = market(t);
  rows[tables.TRADES_TABLE] = undefined;
  const input = {
    projectId, tradeId: "01890b1c-1234-7000-8000-123456789abc", shares: 2, limitPriceCents: 11_000
  };
  const pending = await submitTrade(userId, "BUY", input);
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.limitPriceCents, input.limitPriceCents);
  assert.equal(pending.acceptedIpoAt, 500);
  assert.equal(pending.userId, userId);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].TableName, tables.TRADES_TABLE);
  assert.deepEqual(writes[0].Item, pending);
});

test("a partial sale commits net proceeds, remaining cost basis and realized profit together", async t => {
  const { writes } = market(t);
  const filled = await processTrade(projectId, tradeId);
  assert.equal(filled.status, "FILLED");
  assert.equal(filled.cashDeltaCents, 39_161);
  assert.equal(filled.realizedPnlCents, 7161);
  assert.deepEqual(filled.result, { shares: 6, costBasisCents: 48_000, cashBalanceCents: 139_161 });
  assert.equal(writes.length, 1);
  const items = writes[0].TransactItems;
  const put = table => items.find(item => item.Put?.TableName === table).Put.Item;
  assert.deepEqual(put(tables.TRADES_TABLE), filled);
  assert.equal(put(tables.HOLDINGS_TABLE).costBasisCents, 48_000);
  assert.equal(put(tables.PRICES_TABLE).priceCents, 9980);
  const accountUpdate = items.find(item => item.Update?.TableName === tables.EVENT_ACCOUNTS_TABLE);
  assert.equal(accountUpdate.Update.ExpressionAttributeValues[":cashDelta"], filled.cashDeltaCents);
});

for (const [name, overrides, code] of [
  ["a queued seed order is rejected after IPO", { acceptedIpoAt: null }, "STALE_QUOTE"],
  ["a sale below its limit is rejected", { limitPriceCents: 10_000 }, "LIMIT_PRICE_EXCEEDED"],
  ["a participant cannot sell more shares than they own", { shares: 11 }, "INSUFFICIENT_SHARES"]
]) {
  test(name, async t => {
    const { trade, writes } = market(t);
    Object.assign(trade, overrides);
    const result = await processTrade(projectId, tradeId);
    assert.equal(result.status, "REJECTED");
    assert.equal(result.rejection.code, code);
    assert.deepEqual(writes.map(write => write.TableName), [tables.TRADES_TABLE]);
  });
}

test("redelivering a filled trade leaves cash and holdings untouched", async t => {
  const { trade, writes } = market(t);
  trade.status = "FILLED";
  assert.deepEqual(await processTrade(projectId, tradeId), trade);
  assert.deepEqual(writes, []);
});

test("portfolio values use remaining cost basis and exclude other events' holdings", async t => {
  const { histories } = market(t);
  histories[tables.HOLDINGS_TABLE].push({ projectId: "other:listing", shares: 100 });
  histories[tables.TRADES_TABLE].push({ status: "FILLED", realizedPnlCents: 6000 });
  const p = await getPortfolioForUser(userId);
  assert.equal(p.holdings.length, 1);
  assert.equal(p.totalPortfolioValueCents, 200_000);
  assert.equal(p.unrealizedPnlCents, 20_000);
  assert.equal(p.realizedPnlCents, 6000);
});

test("retrying a grant returns the recorded balance without crediting the participant again", async t => {
  const { projects, writes } = market(t);
  const requestId = "bonus";
  const manifestId = "grant:" + eventId + ":" + requestId;
  projects.set(manifestId, { amountCents: 500, targets: [userId] });
  projects.set(manifestId + ":" + userId, { cashBalanceCents: 100_500 });
  const result = await applyGrant({ requestId, amountCents: 500, targetEmails: [userId, userId] });
  assert.deepEqual(result.outcomes, [{ userId, status: "APPLIED", cashBalanceCents: 100_500, repeated: true }]);
  assert.deepEqual(writes, []);
});
