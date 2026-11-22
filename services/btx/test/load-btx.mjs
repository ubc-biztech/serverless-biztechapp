import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { build } from "esbuild";

// Bundle local TypeScript together so tests and service code share the same mocked clients.
export async function loadBtx(contents) {
  const bundle = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external"
  });
  const module = { exports: {} };
  const load = compileFunction(bundle.outputFiles[0].text, ["require", "module", "exports"]);
  load(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
