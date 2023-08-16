import fs from "fs";
const LINE_NUMBER = 6;
const FILE_LOCATION = "node_modules/hapi/lib/defaults.js";
const INJECT_FIX_STRING = `
var isWin = process.platform === "win32";
var isLinux = process.platform === "linux";
var isDarwin = process.platform === "darwin";
if (isDarwin || isLinux) {
  Os.tmpDir = Os.tmpdir;
} else if (isWin) {
   Os.tmpDir = os.tmpDir;
}
`;

let data = fs.readFileSync(FILE_LOCATION);
if (data.includes(INJECT_FIX_STRING)) {
  console.log("Skipping fix injection, already exists.");
} else {
  data = data.toString().split("\n");
  data.splice(LINE_NUMBER, 0, INJECT_FIX_STRING);
  let text = data.join("\n");

  fs.writeFile(FILE_LOCATION, text, (err) => {
    if (err) {
      return console.log(err);
    } else {
      return console.log("Injected fix successfully");
    }
  });
}
