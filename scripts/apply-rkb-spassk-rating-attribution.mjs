import crypto from "node:crypto";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, root), "utf8"));
const write = (path, value) => {
  const url = new URL(path, root);
  const old = fs.existsSync(url) ? fs.readFileSync(url, "utf8") : "";
  const body = old.includes("\n")
    ? JSON.stringify(value, null, 2) + "\n"
    : JSON.stringify(value);
  fs.writeFileSync(url, body);
};
const hash = path => crypto.createHash("sha256")
  .update(fs.readFileSync(new URL(path, root))).digest("hex");

const catalog = read("config/rkb-spassk-branch.json");
const parentOid = catalog.parent.oid;
const reportingEntityId = "context:spassk-crb";
const spasskPlan = Object.values(read("config/max-targets-2026.json").organizationPlans)
  .find(row => /Спасская ЦРБ/iu.test(row.name ?? ""));
if (!spasskPlan?.oid) throw new Error("Не найден плановый OID Спасской ЦРБ");
const aliases = new Map(catalog.reportAliases.rules.flatMap(rule =>
  rule.metrics.map(metric => [metric, rule.sourceReport])));
const affectedFiles = new Set();
const changes = [];
const emptyValueFields = [
  "fact", "count", "numerator", "denominator", "previous", "june", "july",
  "change", "juneQuantity", "julyQuantity", "plan", "success", "total",
];

function hasFacts(row) {
  return emptyValueFields.some(key => row[key] !== null && row[key] !== undefined);
}

function isParentRkbRow(row) {
  return row.oid === parentOid &&
    /^(?:ГАУЗ\s*)?["«]?РКБ(?:\s+МЗ\s+РТ)?["»]?$/iu.test(String(row.name ?? "").trim());
}

function objectSpans(source) {
  const spans = [];
  const starts = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") {
      starts.push(index);
    } else if (character === "}") {
      const start = starts.pop();
      if (start !== undefined) spans.push([start, index + 1]);
    }
  }
  return spans;
}

function metricRowsSpan(source, metric) {
  const key = metric === "rows" ? '"rows"' : JSON.stringify(metric);
  const keyStart = source.indexOf(key);
  if (keyStart < 0) return null;
  const rowsKeyStart = metric === "rows" ? keyStart : source.indexOf('"rows"', keyStart + key.length);
  if (rowsKeyStart < 0) return null;
  const arrayStart = source.indexOf("[", source.indexOf(":", rowsKeyStart) + 1);
  if (arrayStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "[") depth++;
    else if (character === "]" && --depth === 0) return [arrayStart, index + 1];
  }
  return null;
}

function updateRowInPlace(path, metric, predicate, values) {
  const url = new URL(path, root);
  const source = fs.readFileSync(url, "utf8");
  const parsed = JSON.parse(source);
  const rows = metric === "rows" ? parsed.rows : parsed[metric]?.rows;
  if (!Array.isArray(rows)) return null;
  const row = rows.find(predicate);
  if (!row) return null;
  const rowsSpan = metricRowsSpan(source, metric);
  if (!rowsSpan) throw new Error(path + ":" + metric + ": не найден массив строк");
  const rowsSource = source.slice(rowsSpan[0], rowsSpan[1]);
  const span = objectSpans(rowsSource).find(([start, end]) => {
    const candidate = JSON.parse(rowsSource.slice(start, end));
    return candidate.oid === row.oid && candidate.name === row.name &&
      candidate.reportingEntityId === row.reportingEntityId;
  });
  if (!span) throw new Error(path + ":" + metric + ": не найден исходный фрагмент строки");
  const absoluteSpan = [span[0] + rowsSpan[0], span[1] + rowsSpan[0]];
  let fragment = source.slice(absoluteSpan[0], absoluteSpan[1]);
  for (const [key, value] of Object.entries(values)) {
    const property = new RegExp('("' + key + '"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|null|true|false|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)');
    if (property.test(fragment)) fragment = fragment.replace(property, (_, prefix) => prefix + JSON.stringify(value));
    else {
      const multilineClose = fragment.match(/\n(\s*)\}$/u);
      if (multilineClose) {
        const fieldIndent = fragment.match(/\n(\s+)"[^"\n]+"\s*:/u)?.[1] ?? multilineClose[1] + "  ";
        const closingIndent = multilineClose[1];
        const beforeClose = fragment.slice(0, multilineClose.index);
        fragment = beforeClose + ",\n" + fieldIndent + JSON.stringify(key) + ": " +
          JSON.stringify(value) + "\n" + closingIndent + "}";
      } else {
        fragment = fragment.slice(0, -1) + (fragment.trimEnd().endsWith("{") ? "" : ",") +
          JSON.stringify(key) + ":" + JSON.stringify(value) + "}";
      }
    }
  }
  fs.writeFileSync(url, source.slice(0, absoluteSpan[0]) + fragment + source.slice(absoluteSpan[1]));
  affectedFiles.add(path);
  return { ...row, ...values };
}

function assignRows(path, metric) {
  if (!aliases.has(metric)) return;
  const data = read(path);
  const dataset = data[metric];
  if (!dataset || !Array.isArray(dataset.rows)) return;
  const parentRows = dataset.rows.filter(isParentRkbRow);
  if (!parentRows.length) {
    for (const row of dataset.rows.filter(item => item.reportingEntityId === reportingEntityId)) {
      changes.push({ file: path, metric, status: "verified_context_row",
        sourceReport: row.sourceReport ?? aliases.get(metric),
        reportingEntityId, fact: row.fact ?? row.count ?? null });
    }
    return;
  }
  if (parentRows.length !== 1) throw new Error(path + ":" + metric + ": найдено несколько строк РКБ");
  const parent = parentRows[0];
  const branchRows = dataset.rows.filter(row =>
    row.reportingEntityId === reportingEntityId || row.oid === reportingEntityId);
  const populated = branchRows.find(hasFacts);
  if (populated) {
    changes.push({ file: path, metric, status: "kept_both_rows", note: "Есть отдельная заполненная строка Спасска" });
    return;
  }
  const before = { name: parent.name, oid: parent.oid, fact: parent.fact ?? null, count: parent.count ?? null };
  const updated = updateRowInPlace(path, metric, isParentRkbRow, {
    name: "Спасская ЦРБ", reportingEntityId, sourceReport: aliases.get(metric),
  });
  changes.push({ file: path, metric, status: "attributed_to_spassk", before,
    reportingEntityId, sourceReport: updated.sourceReport });
}

for (const path of ["app/mo-data.json", "app/monthly-mo.json", "app/monthly-2026-10.json", "app/operational-mo.json"]) {
  for (const metric of aliases.keys()) assignRows(path, metric);
}

{
  const path = "app/rating/max-october-2026.json";
  const data = read(path);
  const parent = data.rows.filter(isParentRkbRow);
  const branch = data.rows.find(row => row.reportingEntityId === reportingEntityId);
  if (parent.length > 1) throw new Error("MAX: несколько родительских строк РКБ");
  if (parent.length === 1 && !branch) {
    const row = parent[0];
    const before = { name: row.name, oid: row.oid, tmk: row.tmk, eln: row.eln };
    const updated = updateRowInPlace(path, "rows", isParentRkbRow, {
      name: "Спасская ЦРБ", reportingEntityId,
      sourceReports: ["gis-max-tmk", "gis-max-eln"],
    });
    changes.push({ file: path, metric: "tmkMax/elnMax", status: "attributed_to_spassk",
      before, reportingEntityId, sourceReports: updated.sourceReports });
  } else if (branch) {
    changes.push({ file: path, metric: "tmkMax/elnMax", status: "verified_context_row",
      reportingEntityId, tmk: branch.tmk, eln: branch.eln });
  }
}

{
  const path = "app/max-period-views.json";
  const views = read(path);
  const octoberActuals = read("app/rating/max-october-2026.json").rows
    .find(row => row.reportingEntityId === reportingEntityId);
  const current = read("app/operational-mo.json");
  const month = read("app/monthly-mo.json");
  const updates = [];
  for (const metric of [
    { key: "tmk", source: "tmkMaxCount", field: "tmk" },
    { key: "eln", source: "elnMaxCount", field: "eln" },
  ]) {
    const ytd = current[metric.source].rows.find(row => row.reportingEntityId === reportingEntityId);
    const octoberMonthly = month[metric.source].rows.find(row => row.reportingEntityId === reportingEntityId);
    const octoberFact = octoberActuals?.[metric.field];
    if (!ytd || !Number.isFinite(ytd.fact) || !Number.isFinite(ytd.previous) ||
        !Number.isFinite(octoberFact) || !Number.isFinite(octoberMonthly?.july)) {
      throw new Error("MAX " + metric.key + ": отсутствуют компоненты для сопоставимых срезов");
    }
    const targets = [
      { view: views.closedMonths["2026-10"].cumulative, fact: octoberFact, previous: null },
      { view: views.closedMonths["2026-10"].operational, fact: octoberMonthly.july, previous: octoberMonthly.june ?? null },
      { view: views.cumulative, fact: ytd.previous, previous: octoberFact },
      { view: views.operational, fact: ytd.fact - octoberFact, previous: ytd.previous - octoberFact },
    ];
    for (const target of targets) {
      const entry = target.view.metrics[metric.key];
      const row = entry.rows.find(candidate => candidate.oid === spasskPlan.oid);
      if (!row) throw new Error("MAX " + metric.key + ": нет плановой строки Спасска " + spasskPlan.oid);
      row.fact = target.fact;
      row.previous = target.previous;
      updates.push({ metric: metric.key, period: target.view.period, date: target.view.date,
        fact: target.fact, previous: target.previous });
      entry.plannedMoFact = entry.rows.reduce((sum, candidate) => sum + (Number.isFinite(candidate.fact) ? candidate.fact : 0), 0);
      entry.previousPlannedMoFact = entry.rows.reduce((sum, candidate) => sum + (Number.isFinite(candidate.previous) ? candidate.previous : 0), 0);
    }
  }
  write(path, views);
  affectedFiles.add(path);
  changes.push({ file: path, metric: "tmk/eln", status: "attributed_to_spassk", updates });
}

const filesToHash = [
  "app/mo-data.json", "app/monthly-mo.json", "app/monthly-2026-10.json",
  "app/operational-mo.json", "app/rating/max-october-2026.json",
  "app/max-period-views.json",
];
const hashes = Object.fromEntries(filesToHash.map(path => [path, hash(path)]));
const octoberMax = read("app/rating/max-october-2026.json").rows
  .find(row => row.reportingEntityId === reportingEntityId);
const novemberYtd = read("app/operational-mo.json");
const octoberMonth = read("app/monthly-mo.json");
write("docs/rkb-spassk-rating-attribution-20261114.json", {
  date: "2026-11-14",
  decision: "Разделить Спасскую ЦРБ и РКБ в текущих показателях и октябрьском рейтинге только по заранее разрешённым именованным отчётам; юридические OID и значения источников не переписывать.",
  sourceRegister: {
    file: catalog.frmoSubdivisionRegister.file,
    sha256: catalog.frmoSubdivisionRegister.sha256,
    uniqueSubunits: catalog.frmoSubdivisionRegister.spassk.length + catalog.frmoSubdivisionRegister.rkb.length,
    spassk: catalog.frmoSubdivisionRegister.spassk.length,
    rkb: catalog.frmoSubdivisionRegister.rkb.length,
  },
  aliasRules: catalog.reportAliases.rules,
  unresolvedFrmoRows: catalog.frmoSubdivisionRegister.divisionConflicts,
  unresolvedParentOids: catalog.frmoAudit.parentOidVariants.filter(oid => oid !== parentOid),
  unresolvedLegacyRkbSpOid: "1.2.643.5.1.13.13.12.2.16.1094.0.77684",
  unchangedMetrics: ["hospital", "birth", "death", "other general REMD without 122/228"],
  ratingOutcome: {
    period: "октябрь 2026",
    spasskSeparateRow: true,
    spasskType: "Центральные районные больницы",
    spasskCompleteness: "incomplete; official place remains blank until required values are available",
    spasskOctoberCumulativeSemd228: { numerator: 6621, denominator: 8351 },
    spasskOctoberCumulativeMax: { tmk: octoberMax?.tmk ?? null, eln: octoberMax?.eln ?? null },
    hospitalAndGeneralRemd: "not reassigned",
    historicalSeptemberRatings: "unchanged",
  },
  maxPeriodDerivation: {
    cumulative08Nov: "01.01–08.11 факты взяты из previous-поля накопительного отчёта на 13.11.",
    novemberOperational: "Факт за 01.11–13.11 = накопительный факт на 13.11 минус накопительный факт на 31.10; previous за 01.11–08.11 = накопительный факт на 08.11 минус накопительный факт на 31.10.",
    octoberCumulative: "Факт из подтверждённой накопительной выгрузки MAX по 31.10.",
    octoberOperational: "Факт отдельного октябрьского источника из monthly-mo.json.",
    sourceTotalsUnchanged: true,
  },
  sourceCuts: {
    novemberCumulative: {
      date: novemberYtd.tmkMaxCount.date,
      period: novemberYtd.tmkMaxCount.period,
      tmk: { current: 1331, previous: 1302 },
      eln: { current: 38, previous: 37 },
    },
    octoberMonthly: {
      period: octoberMonth.tmkMaxCount.period,
      tmk: octoberMonth.tmkMaxCount.rows.find(row => row.reportingEntityId === reportingEntityId)?.july ?? null,
      eln: octoberMonth.elnMaxCount.rows.find(row => row.reportingEntityId === reportingEntityId)?.july ?? null,
    },
    octoberCumulative: {
      period: read("app/rating/max-october-2026.json").period,
      tmk: octoberMax?.tmk ?? null,
      eln: octoberMax?.eln ?? null,
    },
  },
  changes,
  resultingSha256: hashes,
  published: false,
}, false);

console.log(JSON.stringify({ changedFiles: [...affectedFiles].sort(), changes, hashes }, null, 2));
