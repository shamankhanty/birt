import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const project = process.cwd();
const work = path.join(project, ".offline-build");
const outputDir = process.env.OFFLINE_OUTPUT_DIR || path.join(project, "offline-output");
const baseName = process.env.OFFLINE_BASENAME || "Дашборд_цифра";
const htmlName = `${baseName}.html`;
const zipName = `${baseName}.zip`;

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(project, "offline/main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "edge100"],
  outfile: path.join(work, "dashboard.js"),
  jsx: "automatic",
  loader: { ".json": "json" },
  plugins: [{
    name: "offline-css",
    setup(buildApi) {
      buildApi.onLoad({ filter: /app\/globals\.css$/ }, async (args) => ({
        contents: (await readFile(args.path, "utf8")).replace(/^@import\s+["']tailwindcss["'];?\s*/m, ""),
        loader: "css",
      }));
    },
  }],
  legalComments: "none",
  sourcemap: false,
});

const [js, css] = await Promise.all([
  readFile(path.join(work, "dashboard.js"), "utf8"),
  readFile(path.join(work, "dashboard.css"), "utf8"),
]);

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Дашборд цифровизации здравоохранения РТ</title>
  <style>${css.replace(/<\/style/gi, "<\\/style")}</style>
</head>
<body>
  <div id="root"></div>
  <script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;

const htmlPath = path.join(outputDir, htmlName);
const zipPath = path.join(outputDir, zipName);
await writeFile(htmlPath, html, "utf8");
await rm(zipPath, { force: true });
execFileSync("zip", ["-j", "-9", zipPath, htmlPath], { stdio: "inherit" });

const external = [...html.matchAll(/(?:src|href)=["'](?!#|data:)([^"']+)["']/gi)].map(m => m[1]);
if (external.length) throw new Error(`Найдены внешние зависимости: ${external.join(", ")}`);
if (!html.includes("Дашборд цифровизации здравоохранения РТ")) throw new Error("Не найден заголовок");
if (!html.includes("waybillDynamics")) throw new Error("Не найден раздел ЭПЛ");

console.log(JSON.stringify({ htmlPath, zipPath, htmlBytes: Buffer.byteLength(html), externalDependencies: external.length }, null, 2));
