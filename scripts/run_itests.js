import { execSync } from "child_process";

const service = process.argv[2] || "all";
const func = process.argv[3] || "all";

let testPath;
if (service === "all") {
  testPath = "./services/*/test_integration";
} else if (func === "all") {
  testPath = `./services/${service}/test_integration`;
} else {
  testPath = `./services/${service}/test_integration/${func}`;
}

const cmd = `mocha --require babel-core/register ${testPath}`;
console.log(`> ${cmd}`);
execSync(cmd, { stdio: "inherit" });
