import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = process.argv[2] || path.join("_site", "reorganizations", "index.html");
const registry = JSON.parse(await readFile("config/mo-reorganizations.json", "utf8"));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const status = (value) => value === "verified" ? "Подтверждено" : "Проверяется";
const date = (value) => String(value).split("-").reverse().join(".");

const groups = registry.groups.map((group) => `
<section class="card">
  <div class="head">
    <p>С ${date(group.effectiveDate)}</p>
    <h2>${escapeHtml(group.name)}</h2>
    <span class="badge">${escapeHtml(group.statusLabel)}</span>
  </div>
  <div class="body">
    <p><b>Документ-основание:</b> ${escapeHtml(group.document.basis)}</p>
    <p><b>Письмо:</b> ${escapeHtml(group.document.title)}</p>
    <p><b>История:</b> ${escapeHtml(group.historicalPolicy)}</p>
    <p><b>Аналитика:</b> ${escapeHtml(group.analyticsPolicy)}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Прежняя МО</th><th>Прежний OID</th><th>OID правопреемника</th><th>ФРМО</th><th>ФРМР</th><th>Выгрузки</th></tr></thead>
        <tbody>${group.predecessors.map((org) => `<tr>
          <td><b>${escapeHtml(org.name)}</b></td>
          <td class="oid">${escapeHtml(org.oldOid)}</td>
          <td class="pending">${escapeHtml(org.successorOid || "Не подтверждён")}</td>
          <td>${status(org.frmoStatus)}</td><td>${status(org.frmrStatus)}</td><td>${status(org.sourceStatus)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <p class="notice">Аналитическая группа и динамика «до/после» не формируются до подтверждения всех связок.</p>
  </div>
</section>`).join("");

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Реестр реорганизаций МО — Цифровое здравоохранение РТ</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4faf7;color:#17352f;font:16px/1.55 Arial,sans-serif}.page{max-width:1180px;margin:auto;padding:32px 20px 64px}a{color:#167e68;font-weight:700;text-decoration:none}.eyebrow{margin:28px 0 4px;color:#6a817b;font-size:13px;font-weight:700;letter-spacing:1.1px}h1{margin:0 0 12px;font-size:34px;line-height:1.2}h2{margin:6px 0 10px;font-size:25px;line-height:1.25}.intro{max-width:850px;color:#556b66}.card{margin-top:28px;overflow:hidden;border:1px solid #d8e5df;border-radius:18px;background:#fff;box-shadow:0 8px 30px rgba(19,72,58,.08)}.head{padding:22px 24px;background:#f1f8f5;border-bottom:1px solid #d8e5df}.head p{margin:0;color:#167e68;font-size:13px;font-weight:700}.badge{display:inline-block;padding:7px 10px;border-radius:8px;background:#fff2d8;color:#745620;font-weight:700;font-size:14px}.body{padding:24px}.body p{margin:0 0 12px}.table-wrap{overflow:auto;margin-top:20px}table{width:100%;min-width:880px;border-collapse:collapse;font-size:14px}th{text-align:left;background:#edf4f1}th,td{padding:12px;border-bottom:1px solid #d8e5df;vertical-align:top}.oid{font:12px monospace}.pending{color:#745620}.notice{margin-top:20px!important;padding:14px;border-radius:10px;background:#fff5df;color:#6d5727}@media(max-width:600px){.page{padding:24px 14px 48px}h1{font-size:28px}.head,.body{padding:18px}h2{font-size:22px}}
</style></head><body><main class="page">
<a href="/birt/">← К дашборду</a><p class="eyebrow">РЕЕСТР ИЗМЕНЕНИЙ МО</p><h1>Реорганизация: контроль идентификаторов</h1>
<p class="intro">Письмо подтверждает реорганизацию, но не заменяет сверку ФРМО, ФРМР и фактических выгрузок. До подтверждения связок строки остаются отдельными; исторические факты и рейтинги не переписываются.</p>
${groups}
</main></body></html>`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, "utf8");
console.log(JSON.stringify({ output, groups: registry.groups.length }, null, 2));
