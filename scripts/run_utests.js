import { readdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const service = process.argv[2] || "all";
const func = process.argv[3] || "all";
const servicesDir = path.join(process.cwd(), "services");

const runTest = (cwd, extraArgs = "") => {
  const cmd = `serverless invoke test --compilers js:babel-core/register${extraArgs}`;
  console.log(`\n> [${path.basename(cwd)}] ${cmd}`);
  execSync(cmd, {
    cwd,
    stdio: "inherit"
  });
};

if (service === "all") {
  for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      runTest(path.join(servicesDir, entry.name));
    } catch {
      // continue to next service on failure
    }
  }
} else if (func === "all") {
  runTest(path.join(servicesDir, service));
} else {
  runTest(path.join(servicesDir, service), ` --function ${func}`);
}
