import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";

const { client, tables, launchIpo, getEventConfig } = await loadBtx(`
  export { default as client } from "../../lib/docClient.js";
  export * as tables from "./repos/tables";
  export { launchIpo } from "./market";
  export { getEventConfig } from "./helpers";
`);
const eventId = "kickstart;2026";
const configId = "config:" + eventId;
process.env.KICKSTART_EVENT_KEY = eventId;

// Apply only the known IPO command shapes; assertions inspect the actual SDK requests.
function fixture(t, count = 2) {
  t.mock.method(Date, "now", () => 1000);
  const config = { projectId: configId, phase: "PRE_IPO", ipoAt: null };
  const projects = Array.from({ length: count }, (_, i) => ({
    projectId: `${eventId}:${i}`, eventId, netShares: i, lastPriceTs: 1100 + i,
    seedSharesAtIpo: null, version: 0
  }));
  const state = { config, projects, scans: [], writes: [], history: new Map(), failCompany: undefined };
  t.mock.method(client, "send", async command => {
    const input = command.input;
    switch (command.constructor.name) {
      case "GetCommand":
        assert.equal(input.Key.projectId, configId);
        assert.equal(input.ConsistentRead, true);
        return { Item: state.config && structuredClone(state.config) };
      case "ScanCommand": {
        assert.equal(config.phase, "IPO_PREPARING", "close formation before discovering companies");
        assert.equal(config.ipoAt, null, "do not expose public trading during preparation");
        assert.equal(input.ConsistentRead, true);
        assert.equal(input.ExpressionAttributeValues[":event"], eventId);
        state.scans.push(input);
        const offset = input.ExclusiveStartKey ? 25 : 0;
        const end = offset === 0 ? 25 : projects.length;
        return { Items: structuredClone(projects.slice(offset, end)),
          ...(offset === 0 && projects.length > 25 ? { LastEvaluatedKey: { projectId: projects[24].projectId } } : {}) };
      }
      case "UpdateCommand": {
        state.writes.push(input);
        const values = input.ExpressionAttributeValues;
        assert.equal(input.Key.projectId, configId);
        assert.ok(input.ConditionExpression);
        if (values[":live"]) Object.assign(config, { phase: "LIVE", ipoAt: values[":ipoAt"] });
        else if (values[":ts"]) config.ipoPriceTs ??= values[":ts"];
        else config.phase = "IPO_PREPARING";
        return {};
      }
      case "TransactWriteCommand": {
        state.writes.push(input);
        const [check, update, put] = input.TransactItems;
        assert.equal(input.TransactItems.length, 3);
        assert.equal(check.ConditionCheck.Key.projectId, configId);
        assert.ok(Object.values(check.ConditionCheck.ExpressionAttributeValues).includes("IPO_PREPARING"));
        assert.match(update.Update.ConditionExpression, /netShares = :shares AND lastPriceTs = :before/);
        assert.match(update.Update.UpdateExpression, /ADD version/);
        const project = projects.find(row => row.projectId === update.Update.Key.projectId);
        if (state.failCompany === project.projectId) throw new Error("simulated transient failure");
        assert.equal(project.seedSharesAtIpo, null);
        const point = put.Put.Item;
        const key = `${point.projectId}:${point.ts}`;
        assert.equal(state.history.has(key), false, "a retry must not duplicate history");
        Object.assign(project, { seedSharesAtIpo: project.netShares, lastPriceTs: point.ts,
          currentPriceCents: point.priceCents, version: project.version + 1 });
        state.history.set(key, point);
        return {};
      }
      case "QueryCommand":
        assert.equal(input.TableName, tables.SOCKETS_TABLE);
        return { Items: [] };
      default:
        assert.fail(command.constructor.name);
    }
  });
  return state;
}

test("IPO closes formation before paginated company discovery and initializes more than 49 companies", async t => {
  const f = fixture(t, 51);
  await launchIpo();
  assert.equal(f.scans.length, 2);
  assert.equal(f.history.size, 51);
  assert.equal(f.config.phase, "LIVE");
  assert.equal(f.config.ipoAt, 1151);
  assert.ok(f.projects.every(project => project.seedSharesAtIpo === project.netShares && project.version === 1));
  assert.equal(f.writes.at(-1).ExpressionAttributeValues[":live"], "LIVE");
});

test("a partial IPO resumes with its original timestamp and skips completed snapshots", async t => {
  const f = fixture(t);
  f.failCompany = f.projects[1].projectId;
  await assert.rejects(launchIpo(), /simulated transient failure/);
  assert.equal(f.config.phase, "IPO_PREPARING");
  assert.equal(f.config.ipoAt, null);
  assert.equal(f.history.size, 1);
  const anchor = f.config.ipoPriceTs;
  f.failCompany = undefined;
  await launchIpo();
  assert.equal(f.config.ipoAt, anchor);
  assert.equal(f.history.size, 2);
  assert.ok(f.projects.every(project => project.version === 1));
  const writeCount = f.writes.length;
  await launchIpo();
  assert.equal(f.writes.length, writeCount, "repeating a completed IPO makes no changes");
});

test("an inconsistent partial snapshot stays paused for reconciliation", async t => {
  const f = fixture(t);
  Object.assign(f.config, { phase: "IPO_PREPARING", ipoPriceTs: 1200 });
  Object.assign(f.projects[0], { seedSharesAtIpo: 0, lastPriceTs: 1199 });
  await assert.rejects(launchIpo(), { statusCode: 503 });
  assert.equal(f.config.phase, "IPO_PREPARING");
  assert.equal(f.writes.length, 0);
});

test("missing and inconsistent config fail closed without market writes", async t => {
  const f = fixture(t);
  for (const config of [undefined, { ipoAt: null }, { phase: "LIVE", ipoAt: null },
    { phase: "PRE_IPO", ipoAt: 1000 }, { phase: "IPO_PREPARING", ipoAt: null, ipoPriceTs: "1000" }]) {
    f.config = config;
    await assert.rejects(getEventConfig(), { statusCode: 503 });
    await assert.rejects(launchIpo(), { statusCode: 503 });
  }
  assert.equal(f.writes.length, 0);
});
