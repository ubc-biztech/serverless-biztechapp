import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";

const { tsHelpers, jsHelpers, validateCompanyProfilePatch, isCompanyProfileComplete,
  CompanyProfileValidationError } = await loadBtx(`
  export { default as tsHelpers } from "../../lib/handlerHelpers.ts";
  export { default as jsHelpers } from "../../lib/handlerHelpers.js";
  export { validateCompanyProfilePatch, isCompanyProfileComplete, CompanyProfileValidationError } from "./companyProfile";
`);
const youtubeURL = "https://youtu.be/dQw4w9WgXcQ";
const complete = { companyName: "Northstar", blurb: "Our company", youtubeURL };

test("both shared helpers preserve existing required/type checks and default 406 responses", t => {
  t.mock.method(console, "error", () => {});
  for (const helpers of [tsHelpers, jsHelpers]) {
    const schema = { name: { required: true, type: "string" }, active: { required: true, type: "boolean" } };
    helpers.checkPayloadProps({ name: "Northstar", active: false }, schema);
    for (const payload of [null, { active: true }, { name: 123, active: true }]) {
      assert.throws(() => helpers.checkPayloadProps(payload, schema), error => {
        assert.equal(error.statusCode, 406);
        assert.equal(typeof JSON.parse(error.body).message, "string");
        return true;
      });
    }
  }
});

test("custom rules skip omitted fields, check types before callbacks and support caller-defined errors", () => {
  for (const helpers of [tsHelpers, jsHelpers]) {
    let calls = 0;
    const schema = { title: { type: "string", validate: value => {
      calls++;
      assert.equal(typeof value, "string");
      return value.length > 3 ? "Title too long" : undefined;
    } } };
    const check = payload => helpers.checkPayloadProps(payload, schema, message => new CompanyProfileValidationError(message));
    check({});
    assert.equal(calls, 0);
    check({ title: "" });
    for (const title of [null, false, 0, undefined]) {
      assert.throws(() => check({ title }), CompanyProfileValidationError);
    }
    assert.equal(calls, 1);
    assert.throws(() => check({ title: "long" }), { name: "CompanyProfileValidationError", message: "Title too long" });
  }
});

test("profile PATCH trims supplied strings, preserves omissions and allows unfinished draft fields", () => {
  const input = { companyName: " Northstar ", blurb: "  ", youtubeURL: "", twitterURL: "" };
  assert.deepEqual(validateCompanyProfilePatch(input), { companyName: "Northstar", blurb: "", youtubeURL: "", twitterURL: "" });
  assert.equal(input.companyName, " Northstar ");
  assert.deepEqual(validateCompanyProfilePatch({ blurb: " Updated " }), { blurb: "Updated" });
});

test("profile PATCH rejects invalid bodies, protected fields, wrong types and invalid supplied links", () => {
  for (const value of [null, [], {}, "profile", { currentPriceCents: 1 }, { companyName: " " },
    { blurb: false }, { youtubeURL: null }, { youtubeURL: "https://youtube.com/@company" },
    { twitterURL: "https://example.com/company" }]) {
    assert.throws(() => validateCompanyProfilePatch(value), CompanyProfileValidationError);
  }
});

test("profile string limits accept the boundary and reject one character beyond it", () => {
  for (const [field, value] of [
    ["companyName", "a".repeat(100)], ["blurb", "a".repeat(2000)],
    ["youtubeURL", youtubeURL + "?t=" + "1".repeat(2048 - youtubeURL.length - 3)],
    ["twitterURL", "https://x.com/" + "a".repeat(2048 - "https://x.com/".length)],
  ]) {
    assert.equal(validateCompanyProfilePatch({ [field]: value })[field], value);
    assert.throws(() => validateCompanyProfilePatch({ [field]: value + "a" }), CompanyProfileValidationError);
  }
});

test("profile completeness reuses the required-field rules and ignores unrelated company attributes", () => {
  assert.equal(isCompanyProfileComplete({ ...complete, twitterURL: "", currentPriceCents: 10000 }), true);
  for (const value of [null, {}, { ...complete, blurb: " " }, { ...complete, youtubeURL: "" },
    { ...complete, youtubeURL: "https://example.com/video" }, { ...complete, companyName: "a".repeat(101) }]) {
    assert.equal(isCompanyProfileComplete(value), false);
  }
});
