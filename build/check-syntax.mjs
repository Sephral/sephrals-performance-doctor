// Syntax check of every script of the module (node --check per file).
import {execFileSync} from "node:child_process";
import {readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["scripts", "build"];
let count = 0;
for ( const dir of dirs ) {
  for ( const name of readdirSync(path.join(root, dir)).filter(f => f.endsWith(".mjs")).sort() ) {
    execFileSync(process.execPath, ["--check", path.join(root, dir, name)], {stdio: "inherit"});
    count++;
  }
}
console.log(`Syntax OK for ${count} files.`);
