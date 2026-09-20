import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = path.resolve(arg("--root", process.cwd()));
const manifestPath = path.resolve(arg("--manifest", path.join(root, "baseline/current-production-manifest.json")));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.kind !== "current-production") throw new Error("current-production manifest expected");
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const [relative, expected] of Object.entries(manifest.files ?? {})) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`manifest file is missing: ${relative}`);
  const actual = sha256(file);
  if (actual !== expected) throw new Error(`current production drift in ${relative}`);
}
console.log(JSON.stringify({ status: "PASS", files: Object.keys(manifest.files ?? {}).length, manifest: manifestPath }));
