import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const project = process.cwd();
const work = process.env.OFFLINE_WORK_DIR || path.join(project, ".offline-build");
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
      if (process.env.DASHBOARD_APP_DIR) {
        buildApi.onLoad({ filter: /[\\/]app[\\/][^\\/]+\.json$/ }, async (args) => ({
          contents: await readFile(path.join(process.env.DASHBOARD_APP_DIR, path.basename(args.path)), "utf8"),
          loader: "json",
        }));
      }
      buildApi.onLoad({ filter: /app[\\/]globals\.css$/ }, async (args) => ({
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

let updateNotice = '';
if (process.env.UPDATER_REPORT_PATH) {
  const report = JSON.parse(await readFile(process.env.UPDATER_REPORT_PATH, 'utf8'));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const prepared = report.indicators.filter(item => item.state === 'PREPARED');
  const retained = report.indicators.filter(item => item.state === 'RETAINED');
  updateNotice = `<aside aria-label="Результат локального обновления" style="padding:12px 24px;background:#fff4cf;color:#342b12;font:14px system-ui">
    <strong>${escapeHtml(report.state)} · Локальное обновление</strong>
    <span> Подготовлено показателей: ${prepared.length}. Прежние данные и периоды сохранены у ${retained.length} показателей.</span>
    <details><summary>Какие показатели не обновлены</summary><ul>${retained.map(item => `<li>${escapeHtml(item.label || item.metric)}: ${escapeHtml(item.errors.join('; '))}. Период: ${escapeHtml(item.previousPeriod?.period || item.previousPeriod?.date || 'без изменений')}.</li>`).join('')}</ul></details>
  </aside>`;
}

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
  ${updateNotice}
  <div id="root"></div>
  <script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;

const htmlPath = path.join(outputDir, htmlName);
const zipPath = path.join(outputDir, zipName);
await writeFile(htmlPath, html, "utf8");
await rm(zipPath, { force: true });
execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  ['-m', 'zipfile', '-c', zipPath, htmlPath], { stdio: "inherit" });

const external = [...html.matchAll(/(?:src|href)=["'](?!#|data:)([^"']+)["']/gi)].map(m => m[1]);
if (external.length) throw new Error(`Найдены внешние зависимости: ${external.join(", ")}`);
if (!html.includes("Дашборд цифровизации здравоохранения РТ")) throw new Error("Не найден заголовок");
if (!html.includes("waybillDynamics")) throw new Error("Не найден раздел ЭПЛ");

console.log(JSON.stringify({ htmlPath, zipPath, htmlBytes: Buffer.byteLength(html), externalDependencies: external.length }, null, 2));
