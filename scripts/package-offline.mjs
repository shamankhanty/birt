import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const buildDir = resolve(projectRoot, "offline-dist");
const packageDir = resolve(projectRoot, "offline-package");

let html = await readFile(resolve(buildDir, "index.html"), "utf8");
const scriptPath = html.match(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/)?.[1];
const stylePath = html.match(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"[^>]*>/)?.[1];

if (!scriptPath || !stylePath) throw new Error("Не удалось определить файлы автономной сборки");

const [javascript, css] = await Promise.all([
  readFile(resolve(buildDir, scriptPath), "utf8"),
  readFile(resolve(buildDir, stylePath), "utf8"),
]);

html = html
  .replace(/<script[^>]+src="\.\/assets\/[^"]+\.js"[^>]*><\/script>/, `<script type="module">${javascript}</script>`)
  .replace(/<link[^>]+href="\.\/assets\/[^"]+\.css"[^>]*>/, `<style>${css}</style>`);

await rm(packageDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });
await writeFile(resolve(packageDir, "dashboard.html"), html);
await cp(resolve(projectRoot, "offline", "README.txt"), resolve(packageDir, "README.txt"));
