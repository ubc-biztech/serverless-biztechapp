import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";
import { claims } from "../../../test/helpers.mjs";

const { db, tables, getQuote, applyGrant, startSeeding, initializeMarketListing, getPortfolioForUser, getTraderLeaderboard, getLeaderboard, getMarketSnapshot, postStartSeeding, processTrade, submitTrade } = await loadBtx(`
  export { default as db } from "../../lib/docClient.js";
  export * as tables from "./repos/tables";
  export { getQuote, applyGrant, startSeeding, initializeMarketListing } from "./market";
  export { getPortfolioForUser, getTraderLeaderboard } from "./repos/accounts";
  export { getLeaderboard, getMarketSnapshot, postStartSeeding } from "./handler";
  export { processTrade, submitTrade } from "./trades";
`);

const eventId = "test-event";
const projectId = eventId + ":listing";
const userId = "participant@example.org";
const tradeId = "order";
const eventEndsAt = 100_000;
process.env.KICKSTART_EVENT_KEY = eventId;
process.env.KICKSTART_EVENT_ENDS_AT = new Date(eventEndsAt).toISOString();

// Supply rows at the DynamoDB boundary and capture the writes requested by each unit.
function market(t) {
  t.mock.method(Date, "now", () => 1000);
  const project = {
    projectId, eventId, seedSharesAtIpo: 0, currentPriceCents: 10_000,
    netShares: 10, lastPriceTs: 900, seedStartedAt: 100, seedEndsAt: 2000
  };
  const config = { projectId: "config:" + eventId, phase: "LIVE", ipoAt: 500 };
  const registration = { registrationStatus: "acceptedComplete" };
  const registrations = new Map([[userId, registration]]);
  const account = { userId, eventId, cashBalanceCents: 100_000, totalAllocatedCents: 120_000 };
  const holding = { userId, projectId, shares: 10, costBasisCents: 80_000 };
  const trade = {
    userId, projectId, tradeId, eventId, side: "SELL", shares: 4,
    limitPriceCents: 9800, status: "PENDING", acceptedIpoAt: 500
  };
  const projects = new Map([[projectId, project], ["config:" + eventId, config]]);
  const rows = {
    [tables.EVENT_ACCOUNTS_TABLE]: account,
    [tables.HOLDINGS_TABLE]: holding, [tables.TRADES_TABLE]: trade
  };
  const histories = { [tables.HOLDINGS_TABLE]: [holding], [tables.TRADES_TABLE]: [], [tables.SOCKETS_TABLE]: [] };
  const writes = [];
  t.mock.method(db, "send", async command => {
    const { Key, TableName } = command.input;
    switch (command.constructor.name) {
      case "GetCommand":
        if (TableName === tables.PROJECTS_TABLE) return { Item: projects.get(Key.projectId) };
        if (TableName === tables.REGISTRATIONS_TABLE) return { Item: registrations.get(Key.id) };
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
  return { trade, config, registration, registrations, histories, projects, project, rows, writes };
}

test("leaderboard displays registration names without returning emails and excludes grants from profit", async t => {
  const { histories, project, rows, registrations } = market(t);
  const other = "other@example.org";
  const tied = "zeta@example.org";
  registrations.set(other, { basicInformation: { fname: " Jordan", lname: "Lee " } });
  registrations.set(userId, { basicInformation: { fname: "Alex", lname: "Kim" } });
  registrations.set(tied, { fname: "Legacy Name", basicInformation: { fname: " ", lname: "" } });
  histories[tables.PROJECTS_TABLE] = [project];
  const account = rows[tables.EVENT_ACCOUNTS_TABLE];
  histories[tables.EVENT_ACCOUNTS_TABLE] = [
    { ...account, userId: tied, cashBalanceCents: 300_000, totalAllocatedCents: 220_000 },
    { ...account, userId: other, cashBalanceCents: 350_000, totalAllocatedCents: 220_000 },
    { ...account, cashBalanceCents: 200_000, totalAllocatedCents: 220_000 }
  ];
  const unrankedBoard = await getTraderLeaderboard("unranked@example.org", 1, 1);
  assert.equal(unrankedBoard.traders, 3);
  assert.deepEqual(unrankedBoard.top, [{ index: 0, rank: 1, displayName: "Jordan Lee", totalPnlCents: 130_000 }]);
  assert.deepEqual(unrankedBoard.bottom, [{ index: 2, rank: 3, displayName: "Participant", totalPnlCents: 80_000 }]);
  assert.equal(unrankedBoard.own, null);

  const privateBoard = await getTraderLeaderboard(userId, 10, 5);
  assert.deepEqual(privateBoard.own, { index: 1, rank: 2, displayName: "Alex Kim", totalPnlCents: 80_000 });
  assert.deepEqual(privateBoard.bottom.map(({ index }) => index), [2, 1, 0]);
  const payload = JSON.stringify(privateBoard);
  for (const address of [userId, other, tied]) assert.ok(!payload.includes(address));
});

test("leaderboard uses the verified caller for their position", async t => {
  const { histories, project, rows } = market(t);
  histories[tables.PROJECTS_TABLE] = [project];
  const account = rows[tables.EVENT_ACCOUNTS_TABLE];
  const other = "another-user@example.org";
  histories[tables.EVENT_ACCOUNTS_TABLE] = [
    account,
    { ...account, userId: other, cashBalanceCents: 300_000 }
  ];
  const queryStringParameters = { viewerId: other };
  const anonymous = await getLeaderboard({ requestContext: {}, queryStringParameters });
  assert.equal(anonymous.statusCode, 401);

  for (const [email, position] of [[userId.toUpperCase(), 1], ["unranked@example.org", null]]) {
    const claims = { email, email_verified: "true" };
    db.send.mock.resetCalls();
    const response = await getLeaderboard({ requestContext: { authorizer: { claims } }, queryStringParameters });
    assert.equal(response.statusCode, 200);
    const { data } = JSON.parse(response.body);
    assert.deepEqual(data.top.map(row => row.index), [0, 1]);
    assert.deepEqual(data.bottom.map(row => row.index), [1, 0]);
    assert.equal(data.own?.index ?? null, position);
    const reads = db.send.mock.calls.map(call => call.arguments[0].input)
      .filter(input => input.TableName === tables.REGISTRATIONS_TABLE);
    assert.deepEqual(reads.map(input => input.Key.id).sort(), [other, userId]);
  }
});

function registrationCheck(items) {
  const check = items.find(item => item.ConditionCheck?.TableName === tables.REGISTRATIONS_TABLE).ConditionCheck;
  assert.match(check.ConditionExpression, /OR/);
  assert.ok(Object.values(check.ExpressionAttributeValues).includes("acceptedComplete"));
  assert.ok(Object.values(check.ExpressionAttributeValues).includes("checkedIn"));
}

test("snapshots clear the old settled-trade decline so admins can retry the reset", async t => {
  const { histories, project, config } = market(t);
  histories[tables.PROJECTS_TABLE] = [project];
  config.lastReset = {
    ipoAt: config.ipoAt, status: "DECLINED", message: "Reset declined because a live trade settled."
  };
  const readReset = async () => JSON.parse((await getMarketSnapshot({})).body).data.lastReset;
  assert.equal(await readReset(), undefined);

  config.lastReset.message = "Reset declined because the price history needs reconciliation.";
  assert.deepEqual(await readReset(), config.lastReset);
});

test("seed quotes and snapshots ignore company activation and use the event cutoff", async t => {
  const { config, project, histories, writes } = market(t);
  config.ipoAt = null;
  config.phase = "PRE_IPO";
  project.seedStartedAt = null;
  histories[tables.PROJECTS_TABLE] = [project];
  Date.now.mock.mockImplementation(() => project.seedEndsAt + 1);
  const buy = () => getQuote({ projectId, userId, side: "BUY", shares: 2 });
  const quote = await buy();
  assert.equal(quote.expiresAt, Date.now() + 30_000);
  assert.equal(quote.totalCostCents, 20_400);
  const snapshot = JSON.parse((await getMarketSnapshot({})).body).data;
  assert.equal(snapshot.projects[0].seedStatus, "ACTIVE");
  assert.equal(snapshot.projects[0].seedEndsAt, eventEndsAt);
  config.phase = "IPO_PREPARING";
  assert.equal(JSON.parse((await getMarketSnapshot({})).body).data.projects[0].seedStatus, "ENDED");
  config.phase = "PRE_IPO";
  Date.now.mock.mockImplementation(() => eventEndsAt - 1);
  assert.equal((await buy()).expiresAt, eventEndsAt);
  Date.now.mock.mockImplementation(() => eventEndsAt);
  await assert.rejects(buy(), { data: { code: "EVENT_ENDED" } });
  assert.deepEqual(writes, []);
});

test("a queued seed buy fills for an unstarted company after its legacy deadline", async t => {
  const { config, project, trade, writes } = market(t);
  Object.assign(config, { phase: "PRE_IPO", ipoAt: null });
  Object.assign(trade, { side: "BUY", acceptedIpoAt: null, limitPriceCents: 10_000 });
  project.seedStartedAt = null;
  Date.now.mock.mockImplementation(() => project.seedEndsAt + 1);
  const result = await processTrade(projectId, tradeId);
  assert.equal(result.status, "FILLED");
  assert.equal(result.priceCents, 10_000);
  assert.equal(result.feeCents, 800);
  assert.equal(result.result.shares, 14);
  const items = writes.find(write => write.TransactItems).TransactItems;
  const companyWrite = items.find(item => item.Update?.TableName === tables.PROJECTS_TABLE).Update;
  assert.match(companyWrite.ConditionExpression, /attribute_exists\(projectId\)/);
  const investorCheck = items.find(item => item.ConditionCheck?.Key.id === userId).ConditionCheck;
  assert.ok(Object.values(investorCheck.ExpressionAttributeNames).includes("teamID"));
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
  registrationCheck(items);
  assert.ok(items.some(item => item.ConditionCheck?.Key.projectId === "config:" + eventId));
  const put = table => items.find(item => item.Put?.TableName === table).Put.Item;
  assert.deepEqual(put(tables.TRADES_TABLE), filled);
  assert.equal(put(tables.HOLDINGS_TABLE).costBasisCents, 48_000);
  assert.equal(put(tables.PRICES_TABLE).priceCents, 9980);
  const accountUpdate = items.find(item => item.Update?.TableName === tables.EVENT_ACCOUNTS_TABLE);
  assert.equal(accountUpdate.Update.ExpressionAttributeValues[":cashDelta"], filled.cashDeltaCents);
});

test("checked-in attendees can quote and receive a grant; commit checks preserve both eligible statuses", async t => {
  const { registration, writes } = market(t);
  registration.registrationStatus = "checkedIn";
  await getQuote({ projectId, userId, side: "BUY", shares: 1 });
  await applyGrant({ requestId: "checked-in", amountCents: 500, targetEmails: [userId] });
  registrationCheck(writes.find(write => write.TransactItems).TransactItems);
});

test("pending registrations cannot quote or receive a grant", async t => {
  const { registration, writes } = market(t);
  registration.registrationStatus = "registered";
  await assert.rejects(getQuote({ projectId, userId, side: "BUY", shares: 1 }), { statusCode: 403 });
  const result = await applyGrant({ requestId: "ineligible", amountCents: 500, targetEmails: [userId] });
  assert.equal(result.outcomes[0].status, "REJECTED");
  assert.equal(writes.filter(write => write.TransactItems).length, 0);
});

test("the legacy seed start route accepts encoded IDs and reports funding without writing", async t => {
  const { config, registration, project, rows, writes } = market(t);
  Object.assign(config, { phase: "PRE_IPO", ipoAt: null });
  Object.assign(project, { seedStartedAt: null, seedEndsAt: null });
  Object.assign(registration, { registrationStatus: "checkedIn", teamID: "listing" });
  rows[tables.TEAMS_TABLE] = { member_ids: [userId] };
  const response = await postStartSeeding({
    pathParameters: { projectId: encodeURIComponent(projectId) },
    requestContext: claims(userId),
  });
  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.projectId, projectId);
  assert.equal(data.seedStatus, "ACTIVE");
  assert.equal(data.seedStartedAt, null);
  assert.equal(data.seedEndsAt, eventEndsAt);
  assert.deepEqual(writes, []);
});

test("IPO preparation blocks new quotes, seed starts and queued fills", async t => {
  const { config, registration, rows, writes } = market(t);
  Object.assign(config, { phase: "IPO_PREPARING", ipoAt: null });
  await assert.rejects(getQuote({ projectId, userId, side: "BUY", shares: 1 }), { statusCode: 503 });
  registration.teamID = "listing";
  rows[tables.TEAMS_TABLE] = { member_ids: [userId] };
  await assert.rejects(startSeeding(userId, projectId), { statusCode: 503 });
  delete registration.teamID;
  const trade = await processTrade(projectId, tradeId);
  assert.equal(trade.rejection.code, "TRANSITION_UNAVAILABLE");
  assert.deepEqual(writes.map(write => write.TableName), [tables.TRADES_TABLE]);
});

test("standalone initialization retains W1 ownership and cleanup metadata with atomic initial history", async t => {
  const { config, projects, writes } = market(t);
  Object.assign(config, { phase: "PRE_IPO", ipoAt: null });
  projects.delete(projectId);
  const result = await initializeMarketListing({ teamCode: "listing", companyName: "Northstar" });
  assert.equal(result.project.teamId, "listing");
  assert.equal(result.project.version, 0);
  assert.equal(result.project.initialPriceTs, result.project.lastPriceTs);
  const items = writes[0].TransactItems;
  assert.equal(items.length, 3);
  const price = items.find(item => item.Put?.TableName === tables.PRICES_TABLE).Put.Item;
  assert.equal(price.source, "INITIAL");
  assert.equal(price.ts, result.project.initialPriceTs);
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
