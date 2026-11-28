import assert from "node:assert/strict";
import { test } from "node:test";
import { condition } from "../../../test/helpers.mjs";
import { loadBtx } from "./load-btx.mjs";

const { buildCompanyProfileSave, getCompanyProfilePermissions } = await loadBtx(`
  export { buildCompanyProfileSave, getCompanyProfilePermissions } from "./companyProfileAccess";
`);
const eventId = "kickstart;2026";
const cutoff = 2000;

function fixture(t) {
  const previous = process.env.KICKSTART_EVENT_ENDS_AT;
  process.env.KICKSTART_EVENT_ENDS_AT = new Date(cutoff).toISOString();
  t.after(() => {
    if (previous === undefined) delete process.env.KICKSTART_EVENT_ENDS_AT;
    else process.env.KICKSTART_EVENT_ENDS_AT = previous;
  });
  return {
    userID: "member@example.com", isMember: true,
    config: { projectId: "config:" + eventId, phase: "PRE_IPO", ipoAt: null },
    company: {
      projectId: eventId + ":004218", eventId, teamId: "004218",
      companyName: "Northstar", blurb: "Our company", youtubeURL: "https://youtu.be/dQw4w9WgXcQ",
      seedStartedAt: null, seedSharesAtIpo: null,
    },
  };
}

test("profile editing uses the configured event cutoff without a DynamoDB eventEndsAt attribute", t => {
  const context = fixture(t);
  assert.deepEqual(getCompanyProfilePermissions(context, cutoff - 1), {
    canEdit: true, canEditName: true, eventEndsAt: cutoff,
  });
  const operations = buildCompanyProfileSave(context, { blurb: "Updated" }, cutoff - 1).map(write => write.build());
  assert.equal(operations.length, 4);
  const configCheck = operations.find(write => write.ConditionCheck?.Key.projectId === context.config.projectId);
  assert.ok(configCheck);
  assert.doesNotMatch(JSON.stringify(configCheck), /eventEndsAt/);
  assert.equal(getCompanyProfilePermissions(context, cutoff).canEdit, false);
  assert.throws(() => buildCompanyProfileSave(context, { blurb: "Updated" }, cutoff), { statusCode: 409 });
});

test("seeding and numeric IPO state lock names while allowing other valid profile edits", t => {
  const base = fixture(t);
  for (const [phase, ipoAt, seedStartedAt, seedSharesAtIpo] of [
    ["PRE_IPO", null, 500, null], ["LIVE", 1000, null, 0],
  ]) {
    const context = { ...base, config: { ...base.config, phase, ipoAt },
      company: { ...base.company, seedStartedAt, seedSharesAtIpo } };
    assert.deepEqual(getCompanyProfilePermissions(context, 1500), {
      canEdit: true, canEditName: false, eventEndsAt: cutoff,
    });
    assert.equal(buildCompanyProfileSave(context, { blurb: "Updated" }, 1500).length, 4);
    assert.throws(() => buildCompanyProfileSave(context, { companyName: "Different name" }, 1500), { statusCode: 409 });
  }
});

test("completeness rules distinguish the stored company from the edited profile", t => {
  const context = fixture(t);
  assert.equal(buildCompanyProfileSave(context, { youtubeURL: "" }, 1500).length, 4);
  Object.assign(context.config, { phase: "LIVE", ipoAt: 1000 });
  assert.equal(buildCompanyProfileSave(context, { youtubeURL: "" }, 1500).length, 4);
  context.company.youtubeURL = "";
  assert.throws(() => buildCompanyProfileSave(context, { blurb: "" }, 1500), { statusCode: 409 });
  context.company.blurb = "";
  const pitch = { youtubeURL: "https://youtu.be/dQw4w9WgXcQ" };
  assert.equal(buildCompanyProfileSave(context, pitch, 1500).length, 4);
  context.company.seedStartedAt = 500;
  assert.throws(() => buildCompanyProfileSave(context, pitch, 1500), { statusCode: 409 });
});

test("missing company state disables editing while null and zero remain valid", t => {
  const context = fixture(t);
  for (const field of ["seedStartedAt", "seedSharesAtIpo"]) {
    const incomplete = { ...context, company: { ...context.company } };
    delete incomplete.company[field];
    assert.deepEqual(getCompanyProfilePermissions(incomplete, 1500), {
      canEdit: false, canEditName: false, eventEndsAt: cutoff,
    });
    assert.throws(() => buildCompanyProfileSave(incomplete, { blurb: "Updated" }, 1500), {
      statusCode: 503, message: "Company state is unavailable. Please contact an organizer.",
    });
    assert.equal(Object.hasOwn(incomplete.company, field), false);
  }
  assert.equal(getCompanyProfilePermissions(context, 1500).canEdit, true);
  assert.doesNotThrow(() => buildCompanyProfileSave(context, { blurb: "Updated" }, 1500).map(write => write.build()));
  Object.assign(context.config, { phase: "LIVE", ipoAt: 1000 });
  Object.assign(context.company, { seedStartedAt: 0, seedSharesAtIpo: 0 });
  assert.equal(getCompanyProfilePermissions(context, 1500).canEdit, true);
  assert.doesNotThrow(() => buildCompanyProfileSave(context, { blurb: "Updated" }, 1500).map(write => write.build()));
});

test("a legacy reset restores editing and repairs the missing snapshot on the next save", t => {
  const context = fixture(t);
  delete context.company.seedSharesAtIpo;
  Object.assign(context.config, {
    previousIpoAt: 1000,
    lastReset: { ipoAt: 1000, status: "SUCCEEDED" },
  });
  assert.deepEqual(getCompanyProfilePermissions(context, 1500), {
    canEdit: true, canEditName: true, eventEndsAt: cutoff,
  });
  const writes = buildCompanyProfileSave(context, { companyName: "Renamed", youtubeURL: "" }, 1500)
    .map(write => write.build());
  const { Update: update } = writes.find(write => write.Update);
  const { ConditionCheck: config } = writes.find(write => write.ConditionCheck?.Key.projectId === context.config.projectId);
  assert.match(condition(update), /attribute_not_exists\(seedSharesAtIpo\)/);
  assert.match(condition(config), /previousIpoAt = 1000/);
  assert.match(condition({ ...update, ConditionExpression: update.UpdateExpression }), /seedSharesAtIpo = null/);

  context.company.seedStartedAt = 500;
  assert.equal(getCompanyProfilePermissions(context, 1500).canEditName, false);
  assert.equal(buildCompanyProfileSave(context, { youtubeURL: "" }, 1500).length, 4);
  context.config.phase = "IPO_PREPARING";
  assert.equal(getCompanyProfilePermissions(context, 1500).canEdit, false);
});

test("missing or invalid market configuration and cutoff disable editing without hiding profile permissions", t => {
  const context = fixture(t);
  for (const config of [undefined, { phase: "LIVE" }, { phase: "UNKNOWN", ipoAt: null },
    { phase: "LIVE", ipoAt: "2026-11-22T00:00:00Z" }]) {
    context.config = config;
    assert.deepEqual(getCompanyProfilePermissions(context, 1500), { canEdit: false, canEditName: false, eventEndsAt: null });
    assert.throws(() => buildCompanyProfileSave(context, { blurb: "Updated" }, 1500), { statusCode: 503 });
  }
  context.config = { projectId: "config:" + eventId, phase: "PRE_IPO", ipoAt: null };
  for (const deadline of [undefined, "not a date"]) {
    if (deadline === undefined) delete process.env.KICKSTART_EVENT_ENDS_AT;
    else process.env.KICKSTART_EVENT_ENDS_AT = deadline;
    assert.equal(getCompanyProfilePermissions(context, 1500).canEdit, false);
    assert.throws(() => buildCompanyProfileSave(context, { blurb: "Updated" }, 1500), { statusCode: 503 });
  }
});
