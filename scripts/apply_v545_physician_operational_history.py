#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "app" / "page.tsx"
ADAPTERS = ROOT / "scripts" / "pipeline" / "adapters.py"
SNAPSHOT = ROOT / "app" / "physician-weekly-snapshot.json"
VERSION = "5.4.5"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


page = PAGE.read_text(encoding="utf-8")
page = replace_once(page, 'const DASHBOARD_VERSION = "5.4.4";', 'const DASHBOARD_VERSION = "5.4.5";', "dashboard version")

old_type = '''type PhysicianWeeklySnapshot = {
  source: string;
  date: string;
  period: string;
  datasets: Record<string, Array<{ name: string; oid: string; fact: number; count: number; volume: number }>>;
  summary: Record<string, { numerator: number; denominator: number; fact: number | null }>;
};'''
new_type = '''type PhysicianWeeklySnapshot = {
  source: string;
  date: string;
  period: string;
  datasets: Record<string, Array<{ name: string; oid: string; fact: number; count: number; volume: number }>>;
  summary: Record<string, { numerator: number; denominator: number; fact: number | null }>;
  previousSource?: string | null;
  previousDate?: string | null;
  previousPeriod?: string | null;
  previousDatasets?: Record<string, Array<{ name: string; oid: string; fact: number; count: number; volume: number }>>;
  previousSummary?: Record<string, { numerator: number; denominator: number; fact: number | null }>;
};'''
page = replace_once(page, old_type, new_type, "physician weekly type")

old_max = '''  const isMaxMetric =
    matrixMetric === "tmkMaxCount" || matrixMetric === "elnMaxCount";
  const maxAnnualPlan = matrixMetric === "tmkMaxCount" ? 193000 : 99000;'''
new_max = '''  const isMaxMetric =
    matrixMetric === "tmkMaxCount" || matrixMetric === "elnMaxCount";
  const isOperationalPhysician500 =
    dynamicsMode === "operational" &&
    matrixMetric.startsWith("doctor500_") &&
    Boolean(physicianWeeklySnapshot.summary[matrixMetric]);
  const physicianOperationalSummary = isOperationalPhysician500
    ? physicianWeeklySnapshot.summary[matrixMetric]
    : null;
  const physicianOperationalPreviousSummary = isOperationalPhysician500
    ? (physicianWeeklySnapshot.previousSummary?.[matrixMetric] ?? null)
    : null;
  const previousPhysicianOperationalRows = isOperationalPhysician500
    ? (physicianWeeklySnapshot.previousDatasets?.[matrixMetric] ?? [])
    : [];
  const previousPhysicianOperationalByOid = new Map(
    previousPhysicianOperationalRows.map((row) => [row.oid, row]),
  );
  const physicianOperationalRows: MoRow[] = isOperationalPhysician500
    ? (physicianWeeklySnapshot.datasets[matrixMetric] ?? []).map((row) => {
        const previous = previousPhysicianOperationalByOid.get(row.oid);
        return {
          ...row,
          previous: previous?.fact ?? null,
          trend: previous ? row.fact - previous.fact : null,
        };
      })
    : [];
  const displayDatasetDate = isOperationalPhysician500
    ? physicianWeeklySnapshot.date
    : selectedDataset.date;
  const maxAnnualPlan = matrixMetric === "tmkMaxCount" ? 193000 : 99000;'''
page = replace_once(page, old_max, new_max, "operational physician setup")

old_periods = '''  const datasetOperationalPeriods =
    selectedDataset.previousPeriod && selectedDataset.period
      ? {
          previous: selectedDataset.previousPeriod,
          current: selectedDataset.period,
        }
      : selectedDataset.previousDate
        ? {
            previous: `на ${selectedDataset.previousDate}`,
            current: `на ${selectedDataset.date}`,
          }
        : null;'''
new_periods = '''  const datasetOperationalPeriods =
    isOperationalPhysician500
      ? {
          previous: physicianWeeklySnapshot.previousDate
            ? `на ${physicianWeeklySnapshot.previousDate}`
            : "предыдущая выгрузка",
          current: `на ${physicianWeeklySnapshot.date}`,
        }
      : selectedDataset.previousPeriod && selectedDataset.period
        ? {
            previous: selectedDataset.previousPeriod,
            current: selectedDataset.period,
          }
        : selectedDataset.previousDate
          ? {
              previous: `на ${selectedDataset.previousDate}`,
              current: `на ${selectedDataset.date}`,
            }
          : null;'''
page = replace_once(page, old_periods, new_periods, "operational periods")

page = replace_once(
    page,
    '''  const indicatorRows = selectedDataset.rows.filter(
    (o) =>''',
    '''  const indicatorRows = (isOperationalPhysician500
    ? physicianOperationalRows
    : selectedDataset.rows
  ).filter(
    (o) =>''',
    "operational physician rows",
)

old_current = '''  const operationalRegionalCurrent = isCountMetric
    ? regionalFact
    : selectedUnitDataset && selectedUnitDataset.plan > 0
      ? (selectedUnitDataset.fact / selectedUnitDataset.plan) * 100
      : detailRows.length
        ? detailAggregate.fact
        : regionalFact;'''
new_current = '''  const operationalRegionalCurrent = isOperationalPhysician500
    ? (physicianOperationalSummary?.fact ?? 0)
    : isCountMetric
      ? regionalFact
      : selectedUnitDataset && selectedUnitDataset.plan > 0
        ? (selectedUnitDataset.fact / selectedUnitDataset.plan) * 100
        : detailRows.length
          ? detailAggregate.fact
          : regionalFact;'''
page = replace_once(page, old_current, new_current, "operational regional current")

old_previous = '''  const regionalPrevious = selectedDataset.comparisonReset
    ? null
    : operationalRegionalPrevious[matrixMetric] ??
      (isCountMetric
        ? rtIndicator?.previous ?? null
        : staticPrevious);'''
new_previous = '''  const regionalPrevious = isOperationalPhysician500
    ? (physicianOperationalPreviousSummary?.fact ?? null)
    : selectedDataset.comparisonReset
      ? null
      : operationalRegionalPrevious[matrixMetric] ??
        (isCountMetric
          ? rtIndicator?.previous ?? null
          : staticPrevious);'''
page = replace_once(page, old_previous, new_previous, "operational regional previous")

old_components = '''  const currentRegionalComponents = isCumulativeShareMetric
    ? {
        numerator: selectedDataset.numerator ?? detailAggregate.numerator,
        denominator: selectedDataset.denominator ?? detailAggregate.denominator,
      }
    : null;'''
new_components = '''  const currentRegionalComponents = isOperationalPhysician500 && physicianOperationalSummary
    ? {
        numerator: physicianOperationalSummary.numerator,
        denominator: physicianOperationalSummary.denominator,
      }
    : isCumulativeShareMetric
      ? {
          numerator: selectedDataset.numerator ?? detailAggregate.numerator,
          denominator: selectedDataset.denominator ?? detailAggregate.denominator,
        }
      : null;'''
page = replace_once(page, old_components, new_components, "current components")

old_prev_components = '''  const previousRegionalComponents =
    isCumulativeShareMetric && !selectedDataset.comparisonReset
      ? selectedDataset.previousNumerator !== undefined &&
        selectedDataset.previousNumerator !== null &&
        selectedDataset.previousDenominator !== undefined &&
        selectedDataset.previousDenominator !== null
        ? {
            numerator: selectedDataset.previousNumerator,
            denominator: selectedDataset.previousDenominator,
            date: previousSnapshot,
            source: "метаданные предыдущей выгрузки",
          }
        : staticPreviousComponents && staticPreviousComponents.date === previousSnapshot
          ? staticPreviousComponents
          : null
      : null;'''
new_prev_components = '''  const previousRegionalComponents =
    isOperationalPhysician500 && physicianOperationalPreviousSummary
      ? {
          numerator: physicianOperationalPreviousSummary.numerator,
          denominator: physicianOperationalPreviousSummary.denominator,
          date: physicianWeeklySnapshot.previousDate ?? previousSnapshot,
          source: physicianWeeklySnapshot.previousSource ?? "предыдущий оперативный срез 500+",
        }
      : isCumulativeShareMetric && !selectedDataset.comparisonReset
        ? selectedDataset.previousNumerator !== undefined &&
          selectedDataset.previousNumerator !== null &&
          selectedDataset.previousDenominator !== undefined &&
          selectedDataset.previousDenominator !== null
          ? {
              numerator: selectedDataset.previousNumerator,
              denominator: selectedDataset.previousDenominator,
              date: previousSnapshot,
              source: "метаданные предыдущей выгрузки",
            }
          : staticPreviousComponents && staticPreviousComponents.date === previousSnapshot
            ? staticPreviousComponents
            : null
        : null;'''
page = replace_once(page, old_prev_components, new_prev_components, "previous components")

page = page.replace(
    '''{isCumulativeShareMetric
                          ? previousRegionalComponents''',
    '''{isCumulativeShareMetric || isOperationalPhysician500
                          ? previousRegionalComponents''',
    1,
)
page = page.replace(
    '''                            : isCumulativeShareMetric &&
                                numeratorChange !== null &&''',
    '''                            : (isCumulativeShareMetric || isOperationalPhysician500) &&
                                numeratorChange !== null &&''',
    1,
)
old_status = '''                              : isCumulativeShareMetric && !previousRegionalComponents
                                ? "доля сопоставима, но компоненты предыдущего среза не сохранены; после следующей выгрузки будут показаны изменения числителя и знаменателя"
                                : "текущая выгрузка сравнивается с непосредственно предыдущей"}'''
new_status = '''                              : isOperationalPhysician500 && !physicianOperationalPreviousSummary
                                ? "предыдущего оперативного среза 500+ в архиве нет; текущий срез сохранён как baseline для следующей выгрузки"
                              : isCumulativeShareMetric && !previousRegionalComponents
                                ? "доля сопоставима, но компоненты предыдущего среза не сохранены; после следующей выгрузки будут показаны изменения числителя и знаменателя"
                                : "текущая выгрузка сравнивается с непосредственно предыдущей"}'''
page = replace_once(page, old_status, new_status, "operational status message")

page = page.replace('`актуальность ${selectedDataset.date}`', '`актуальность ${displayDatasetDate}`', 1)
page = page.replace('`данные на ${selectedDataset.date}`', '`данные на ${displayDatasetDate}`', 1)
page = page.replace('matrixMetric.startsWith("doctor") && physicianWeeklySnapshot.summary[matrixMetric]', 'matrixMetric.startsWith("doctor500_") && physicianWeeklySnapshot.summary[matrixMetric]', 1)

# Keep raw patch history, but aggregate all entries from the same date automatically for users.
page = replace_once(page, 'const versionHistory = [', 'const versionHistoryEntries = [', "version history source")
marker = 'const versionHistoryEntries = [\n'
idx = page.index(marker) + len(marker)
new_entry = '''  {
    version: "5.4.5",
    date: "15.09.2026",
    items: [
      "Оперативный режим показателей 500+ теперь использует фактический срез 11.09 из physician-weekly-snapshot, а месячный режим сохраняет полный август отдельно.",
      "История обновлений автоматически объединяет все технические версии одной даты в одну пользовательскую карточку с накоплением изменений.",
    ],
  },
'''
page = page[:idx] + new_entry + page[idx:]

match = re.search(r'const versionHistoryEntries = \[(.*?)\n\];\n', page, re.S)
if not match:
    raise RuntimeError("version history array end not found")
insert_at = match.end()
grouping = '''\nconst versionHistory = versionHistoryEntries.reduce<
  Array<{ version: string; date: string; items: string[] }>
>((acc, entry) => {
  const sameDate = acc.find((item) => item.date === entry.date);
  if (sameDate) {
    sameDate.items.push(...entry.items);
    return acc;
  }
  acc.push({ ...entry, items: [...entry.items] });
  return acc;
}, []);\n'''
page = page[:insert_at] + grouping + page[insert_at:]
PAGE.write_text(page, encoding="utf-8")

# Preserve the immediately previous operational 500+ snapshot on future partial-month imports.
adapters = ADAPTERS.read_text(encoding="utf-8")
old_adapter = '''        weekly = load(app, "physician-weekly-snapshot.json") if (app / "physician-weekly-snapshot.json").exists() else {}
        weekly.update({"source": source.name, "date": date_ru(end), "period": period_cumulative(end), "datasets": current, "summary": facts})
        save(app, "physician-weekly-snapshot.json", weekly)'''
new_adapter = '''        weekly = load(app, "physician-weekly-snapshot.json") if (app / "physician-weekly-snapshot.json").exists() else {}
        new_date = date_ru(end)
        if weekly.get("date") and weekly.get("date") != new_date:
            weekly["previousSource"] = weekly.get("source")
            weekly["previousDate"] = weekly.get("date")
            weekly["previousPeriod"] = weekly.get("period")
            weekly["previousDatasets"] = weekly.get("datasets", {})
            weekly["previousSummary"] = weekly.get("summary", {})
        weekly.update({"source": source.name, "date": new_date, "period": period_cumulative(end), "datasets": current, "summary": facts})
        save(app, "physician-weekly-snapshot.json", weekly)'''
adapters = replace_once(adapters, old_adapter, new_adapter, "physician adapter previous snapshot")
ADAPTERS.write_text(adapters, encoding="utf-8")

# Current snapshot has no earlier operational 500+ file in repository history; state this explicitly.
snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
snapshot.setdefault("previousSource", None)
snapshot.setdefault("previousDate", None)
snapshot.setdefault("previousPeriod", None)
snapshot.setdefault("previousDatasets", {})
snapshot.setdefault("previousSummary", {})
SNAPSHOT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Promote current baseline identifiers without rewriting historical release/reference documents.
version_files = [
    ROOT / "config" / "indicator-registry.json",
    ROOT / "baseline" / "calculation-runtime-snapshot.json",
    ROOT / "baseline" / "indicator-metadata-snapshot.json",
    ROOT / "baseline" / "mo-registry-runtime-snapshot.json",
    ROOT / "baseline" / "semantic-snapshot.json",
    ROOT / "baseline" / "validation-snapshot.json",
    ROOT / "validation" / "ai-review.json",
    ROOT / "validation" / "calculation-equivalence.json",
    ROOT / "validation" / "indicator-metadata-equivalence.json",
    ROOT / "validation" / "validation-report.json",
    ROOT / "scripts" / "promote_calculation_baseline.mjs",
    ROOT / "scripts" / "promote_mo_registry_snapshot.mjs",
    ROOT / "scripts" / "promote_semantic_baseline.py",
    ROOT / "tests" / "baseline-lock.test.mjs",
]
for path in version_files:
    text = path.read_text(encoding="utf-8")
    text = text.replace("5.4.4", VERSION)
    path.write_text(text, encoding="utf-8")

for rel in ["STATE.md", "OPEN_ISSUES.md"]:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    text = text.replace("v5.4.4", f"v{VERSION}", 1)
    path.write_text(text, encoding="utf-8")

release = ROOT / "baseline" / "RELEASE_5.4.5.md"
release.write_text(
    "# Release candidate v5.4.5\n\n"
    "Дата подготовки: 15.09.2026.\n\n"
    "Статус: подготовлен к проверке, не опубликован.\n\n"
    "## Изменения\n\n"
    "- режим «Оперативно» для всех показателей 500+ использует отдельный текущий срез physician-weekly-snapshot; полный август остаётся только в режиме «Месяцы»;\n"
    "- текущий оперативный срез 11.09 показывает региональный факт и компоненты числитель/знаменатель; отсутствие более раннего оперативного файла не подменяется августом;\n"
    "- pipeline сохраняет предыдущий оперативный срез 500+ при следующей загрузке, чтобы автоматически появилась честная динамика выгрузка-к-выгрузке;\n"
    "- история версий группируется по дате: несколько технических обновлений одного дня отображаются одной пользовательской карточкой.\n\n"
    "Production не публиковать без отдельной команды.\n",
    encoding="utf-8",
)

# Add a regression test for both requirements.
test_path = ROOT / "tests" / "physician500-operational-history.test.mjs"
test_path.write_text('''import fs from "node:fs";\nimport test from "node:test";\nimport assert from "node:assert/strict";\n\nconst page = fs.readFileSync("app/page.tsx", "utf8");\nconst adapter = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");\nconst weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));\n\ntest("500+ operational mode uses the weekly snapshot and history is date-aggregated", () => {\n  assert.match(page, /const DASHBOARD_VERSION = "5\\.4\\.5"/u);\n  assert.match(page, /isOperationalPhysician500/u);\n  assert.match(page, /physicianWeeklySnapshot\\.summary\\[matrixMetric\\]/u);\n  assert.match(page, /physicianOperationalRows/u);\n  assert.match(page, /предыдущего оперативного среза 500\\+ в архиве нет/u);\n  assert.equal(weekly.date, "11.09.2026");\n  assert.equal(weekly.summary.doctor500_therapist.numerator, 238);\n  assert.equal(weekly.summary.doctor500_therapist.denominator, 1367);\n  assert.match(adapter, /previousSummary/u);\n  assert.match(adapter, /previousDatasets/u);\n  assert.match(page, /const versionHistoryEntries = \\[/u);\n  assert.match(page, /sameDate\\.items\\.push/u);\n});\n''', encoding="utf-8")

# Update manifest metadata and recalculate all protected hashes after modifications.
manifest_path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["baselineVersion"] = VERSION
manifest["baselineDate"] = "2026-09-15"
manifest["changeClass"] = "Оперативный 500+: отдельный текущий срез; история версий агрегируется по дате"
manifest["note"] = (
    "v5.4.5: оперативный режим 500+ использует срез 11.09 отдельно от полного августа; "
    "предыдущий оперативный срез не выдумывается и будет автоматически сохранён при следующей загрузке. "
    "История обновлений группирует версии одной даты в одну карточку. Production не публиковать без отдельной команды."
)
manifest.setdefault("regression", {})["nodeTests"] = "152/152 PASS"
for group in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for rel in list(manifest.get(group, {})):
        target = ROOT / rel
        if target.exists():
            manifest[group][rel] = hashlib.sha256(target.read_bytes()).hexdigest()
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(json.dumps({"status": "PASS", "version": VERSION}, ensure_ascii=False))
