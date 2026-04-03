import { readdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const cmd = process.argv.slice(2).join(" ");
const servicesDir = path.join(process.cwd(), "services");

for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const cwd = path.join(servicesDir, entry.name);
  console.log(`\n> [${entry.name}] ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch {
    // continue to next service on failure
  }
}
