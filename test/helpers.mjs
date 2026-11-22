import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

/** Bundle real backend code once; create fresh isolated infrastructure per test. */
export async function isolateHandler(entry, mocks) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "unit-infrastructure", setup(build) {
      build.onResolve({ filter: /docClient(?:\.js)?$/ }, () =>
        Object.hasOwn(mocks, "../../lib/docClient.js")
          ? { path: "../../lib/docClient.js", namespace: "mock" } : undefined);
      build.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
    } }],
  });
  return (infrastructure, env = {}) => {
    const context = vm.createContext({
      module: { exports: {} }, require: createRequire(import.meta.url),
      process: { env }, infrastructure, Set, Buffer, Date, Error,
      console: { log() {}, warn() {}, error() {} },
    });
    vm.runInContext(result.outputFiles[0].text, context);
    return context.module.exports;
  };
}

export const claims = (email = "alice@example.com") => ({
  authorizer: { claims: { email, email_verified: "true" } },
});

export function conflict(items, index = 0) {
  return Object.assign(new Error("State changed"), {
    name: "TransactionCanceledException",
    CancellationReasons: items.map((_, i) => ({ Code: i === index ? "ConditionalCheckFailed" : "None" })),
  });
}

/** Expand aliases for assertions about the database guards, without simulating DynamoDB. */
export const condition = action => action.ConditionExpression
  .replace(/#[\w]+/g, name => action.ExpressionAttributeNames[name])
  .replace(/:[\w]+/g, name => JSON.stringify(action.ExpressionAttributeValues[name]));
