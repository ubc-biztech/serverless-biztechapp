import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

async function load(relativePath) {
  const result = await bundle({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm"
  });

  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

let build, field, anyOf, allOf, txn;
let originalEnvironment;

before(async () => {
  ({ build, field, anyOf, allOf } = await load("../build.ts"));
  ({ txn } = await load("../txn.ts"));
});

beforeEach(() => {
  originalEnvironment = process.env.ENVIRONMENT;
  delete process.env.ENVIRONMENT;
});

afterEach(() => {
  if (originalEnvironment === undefined) {
    delete process.env.ENVIRONMENT;
  } else {
    process.env.ENVIRONMENT = originalEnvironment;
  }
});

test("unconditional put and delete omit expression parameters", () => {
  const item = {
    id: "user-1",
    status: "active"
  };
  const key = {
    id: "user-1",
    "eventID;year": "blueprint;2027"
  };

  assert.deepEqual(build.put("users", item).build(), {
    Put: {
      TableName: "users",
      Item: item
    }
  });
  assert.deepEqual(build.delete("registrations", key).build(), {
    Delete: {
      TableName: "registrations",
      Key: key
    }
  });
});

test("existence conditions alias literal attribute names and omit values", () => {
  const write = build.put("profiles", { id: "user-1" })
    .if("eventID;year").notExists()
    .if("status").exists()
    .if("display.name").notExists();

  assert.deepEqual(write.build().Put, {
    TableName: "profiles",
    Item: { id: "user-1" },
    ConditionExpression: "attribute_not_exists(#c0) AND attribute_exists(#c1) AND attribute_not_exists(#c2)",
    ExpressionAttributeNames: {
      "#c0": "eventID;year",
      "#c1": "status",
      "#c2": "display.name"
    }
  });
});

test("nested groups preserve AND/OR precedence and distinct equality values", () => {
  const write = build.delete("profiles", { id: "user-1" })
    .if("id").exists()
    .anyOf(
      field("status").equals("active"),
      allOf(
        field("status").notExists(),
        anyOf(field("owner").equals("alice"), field("owner").equals("bob"))
      )
    )
    .if("archived").equals(false);

  const params = write.build().Delete;
  assert.equal(params.ConditionExpression,
    "attribute_exists(#c0) AND (#c1 = :c0 OR (attribute_not_exists(#c2) AND (#c3 = :c1 OR #c4 = :c2))) AND #c5 = :c3");
  assert.deepEqual(params.ExpressionAttributeNames, {
    "#c0": "id",
    "#c1": "status",
    "#c2": "status",
    "#c3": "owner",
    "#c4": "owner",
    "#c5": "archived"
  });
  assert.deepEqual(params.ExpressionAttributeValues, {
    ":c0": "active",
    ":c1": "alice",
    ":c2": "bob",
    ":c3": false
  });
});

test("allOf retains false, zero, empty string, and null equality values", () => {
  const write = build.put("users", { id: "user-1" }).allOf(
    field("enabled").equals(false),
    field("count").equals(0),
    field("label").equals(""),
    field("deletedAt").equals(null)
  );

  assert.equal(write.build().Put.ConditionExpression,
    "(#c0 = :c0 AND #c1 = :c1 AND #c2 = :c2 AND #c3 = :c3)");
  assert.deepEqual(write.build().Put.ExpressionAttributeValues, {
    ":c0": false,
    ":c1": 0,
    ":c2": "",
    ":c3": null
  });
});

test("repeat builds apply the suffix once and do not retain expression state", () => {
  process.env.ENVIRONMENT = "-test";
  for (const write of [
    build.put("users", { id: "user-1" }),
    build.delete("users", { id: "user-1" })
  ]) {
    write.if("status").equals("active");
    const originalConditions = structuredClone(write.conditions);
    const first = write.build();
    const second = write.build();
    assert.deepEqual(first, second);
    assert.equal(Object.values(first)[0].TableName, "users-test");
    assert.equal(write.table, "users");
    assert.deepEqual(write.conditions, originalConditions);
    Object.values(first)[0].ExpressionAttributeNames["#c0"] = "changed";
    assert.deepEqual(write.build(), second);
  }
});

test("invalid conditions fail before producing a write", () => {
  assert.throws(() => anyOf(), /at least one condition/);
  assert.throws(() => allOf(), /at least one condition/);
  const write = build.put("users", { id: "user-1" });
  assert.throws(() => write.anyOf(), /at least one condition/);
  assert.throws(() => write.allOf(), /at least one condition/);
  assert.deepEqual(write.conditions, []);
  assert.throws(() => write.if("status").equals(undefined).build(), /undefined/);
  assert.throws(() => build.delete("users", { id: "user-1" }).if("").exists().build(), /must not be empty/);
  assert.throws(() => build.put("users", {}).anyOf({
    type: "and",
    conditions: []
  }).build(), /at least one condition/);
});

test("txn remains an explicit execution scaffold", async () => {
  await assert.rejects(txn(build.put("users", { id: "user-1" })), /txn\(\) execution is not implemented/);
});
