import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const snapshot = path.resolve(arg("--snapshot") ?? "");
if (!snapshot) throw new Error("--snapshot is required");
const production = path.resolve(arg("--production") ?? path.join(root, "app"));
const manifestPath = path.join(root, "baseline/current-production-manifest.json");
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, "manifest.json"), "utf8"));
for (const name of Object.keys(manifest.files)) fs.copyFileSync(path.join(snapshot, "app", name), path.join(production, name));
if (manifest.currentProductionManifest) fs.writeFileSync(manifestPath, Buffer.from(manifest.currentProductionManifest, "base64"));
for (const [file, encoded] of Object.entries(manifest.currentSnapshots ?? {})) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), Buffer.from(encoded, "base64")); }
console.log(JSON.stringify({ status: "PASS", restored: Object.keys(manifest.files).length, snapshot }));
