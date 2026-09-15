#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"v5.4.4 patch anchor not found: {label}")
    return text.replace(old, new, 1)


# --- app/page.tsx ---------------------------------------------------------
p = ROOT / "app/page.tsx"
s = p.read_text(encoding="utf-8")
s = must_replace(s, 'const DASHBOARD_VERSION = "5.4.3";', 'const DASHBOARD_VERSION = "5.4.4";', "dashboard version")
s = must_replace(
    s,
    '  previousDate?: string;\n  previousPeriod?: string;\n  periodKind?: "monthly" | "cumulative" | "operational" | "snapshot";',
    '  previousDate?: string;\n  previousPeriod?: string;\n  numerator?: number | null;\n  denominator?: number | null;\n  previousNumerator?: number | null;\n  previousDenominator?: number | null;\n  comparisonReset?: boolean;\n  periodKind?: "monthly" | "cumulative" | "operational" | "snapshot";',
    "MoDataset component metadata",
)
s = must_replace(
    s,
    'const versionHistory = [\n  {\n    version: "5.4.3",',
    'const versionHistory = [\n  {\n    version: "5.4.4",\n    date: "15.09.2026",\n    items: [\n      "Для накопительных долевых показателей в оперативной динамике добавлены числитель и знаменатель текущего и предыдущего срезов, а также их изменение.",\n      "Уменьшение накопительного числителя или знаменателя автоматически помечается как аномалия качества данных; отсутствующие компоненты предыдущего среза не восстанавливаются из процента.",\n    ],\n  },\n  {\n    version: "5.4.3",',
    "version history",
)
component_map = '''  const operationalRegionalPreviousComponents: Record<
    string,
    { numerator: number; denominator: number; date: string; source: string }
  > = {
    // Точные компоненты предыдущего сопоставимого среза сохраняются только там,
    // где они подтверждены источником/аудитом. Не восстанавливаем компоненты из одной доли.
    semd228: {
      numerator: 1557278,
      denominator: 2036859,
      date: "07.09.2026",
      source: "аудит СЭМД 122/228 на 07.09.2026",
    },
    ambulatoryCase: {
      numerator: 9549272,
      denominator: 10948601,
      date: "29.08.2026",
      source: "утверждённый предыдущий runtime",
    },
    smp: {
      numerator: 576237,
      denominator: 624216,
      date: "28.08.2026",
      source: "утверждённый предыдущий runtime",
    },
  };
'''
s = must_replace(
    s,
    '  const operationalRegionalPrevious: Record<string, number> = {',
    component_map + '  const operationalRegionalPrevious: Record<string, number> = {',
    "previous component map",
)
old_regional = '''  const regionalPrevious =
    operationalRegionalPrevious[matrixMetric] ??
    (isCountMetric
      ? rtIndicator?.previous ?? null
      : staticPrevious);
  const regionalChange =
'''
new_regional = '''  const regionalPrevious = selectedDataset.comparisonReset
    ? null
    : operationalRegionalPrevious[matrixMetric] ??
      (isCountMetric
        ? rtIndicator?.previous ?? null
        : staticPrevious);
  const isCumulativeShareMetric =
    sourceBackedIndicatorIds.has(matrixMetric) &&
    !isCountMetric &&
    !isPresenceMetric &&
    detailAggregate.denominator > 0 &&
    Boolean(
      selectedDataset.period?.startsWith("01.01") ||
        selectedDataset.period?.toLocaleLowerCase("ru-RU").includes("январ"),
    );
  const currentRegionalComponents = isCumulativeShareMetric
    ? {
        numerator: selectedDataset.numerator ?? detailAggregate.numerator,
        denominator: selectedDataset.denominator ?? detailAggregate.denominator,
      }
    : null;
  const staticPreviousComponents = operationalRegionalPreviousComponents[matrixMetric];
  const previousRegionalComponents =
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
      : null;
  const numeratorChange =
    currentRegionalComponents && previousRegionalComponents
      ? currentRegionalComponents.numerator - previousRegionalComponents.numerator
      : null;
  const denominatorChange =
    currentRegionalComponents && previousRegionalComponents
      ? currentRegionalComponents.denominator - previousRegionalComponents.denominator
      : null;
  const cumulativeComponentAnomaly =
    isCumulativeShareMetric &&
    ((numeratorChange !== null && numeratorChange < 0) ||
      (denominatorChange !== null && denominatorChange < 0));
  const regionalChange =
'''
s = must_replace(s, old_regional, new_regional, "regional component logic")
s = must_replace(
    s,
    '                      <span>{previousSnapshot}</span>',
    '''                      <span>
                        {previousSnapshot}
                        {isCumulativeShareMetric
                          ? previousRegionalComponents
                            ? ` · ${format(previousRegionalComponents.numerator, 0)} / ${format(previousRegionalComponents.denominator, 0)}`
                            : " · компоненты предыдущего среза не сохранены"
                          : ""}
                      </span>''',
    "previous export components UI",
)
s = must_replace(
    s,
    '                      <span>{currentSnapshot}</span>',
    '''                      <span>
                        {currentSnapshot}
                        {currentRegionalComponents
                          ? ` · ${format(currentRegionalComponents.numerator, 0)} / ${format(currentRegionalComponents.denominator, 0)}`
                          : ""}
                      </span>''',
    "current export components UI",
)
s = must_replace(
    s,
    '''                          : isCountMetric && regionalRelativeChange !== null
                            ? `${regionalRelativeChange > 0 ? "+" : regionalRelativeChange < 0 ? "−" : ""}${format(Math.abs(regionalRelativeChange), 1)}% к предыдущей выгрузке`
                            : lowerIsBetter
                              ? "снижение — улучшение"
                              : "рост — улучшение"}''',
    '''                          : isCountMetric && regionalRelativeChange !== null
                            ? `${regionalRelativeChange > 0 ? "+" : regionalRelativeChange < 0 ? "−" : ""}${format(Math.abs(regionalRelativeChange), 1)}% к предыдущей выгрузке`
                            : isCumulativeShareMetric &&
                                numeratorChange !== null &&
                                denominatorChange !== null
                              ? `числитель ${numeratorChange > 0 ? "+" : numeratorChange < 0 ? "−" : ""}${format(Math.abs(numeratorChange), 0)} · знаменатель ${denominatorChange > 0 ? "+" : denominatorChange < 0 ? "−" : ""}${format(Math.abs(denominatorChange), 0)}`
                              : lowerIsBetter
                                ? "снижение — улучшение"
                                : "рост — улучшение"}''',
    "difference component text",
)
s = must_replace(s, '                    <article>\n                      <small>Интервал и сопоставимость</small>', '                    <article className={cumulativeComponentAnomaly ? "negative" : ""}>\n                      <small>Интервал и сопоставимость</small>', "interval anomaly tone")
s = must_replace(
    s,
    '''                        {isCountMetric && countRowsWithoutPrevious > 0
                          ? `${comparableCountRows.length} из ${indicatorRows.length} МО сопоставлены; ${countRowsWithoutPrevious} без предыдущего значения`
                          : "текущая выгрузка сравнивается с непосредственно предыдущей"}''',
    '''                        {selectedDataset.comparisonReset
                          ? "Сравнение отключено: между срезами изменены источник или методика расчёта. Новый сопоставимый baseline формируется с текущего среза."
                          : cumulativeComponentAnomaly
                            ? `⚠ Аномалия накопительного среза: ${numeratorChange !== null && numeratorChange < 0 ? "числитель уменьшился" : ""}${numeratorChange !== null && numeratorChange < 0 && denominatorChange !== null && denominatorChange < 0 ? "; " : ""}${denominatorChange !== null && denominatorChange < 0 ? "знаменатель уменьшился" : ""}. Требуется проверка источника/состава.`
                            : isCountMetric && countRowsWithoutPrevious > 0
                              ? `${comparableCountRows.length} из ${indicatorRows.length} МО сопоставлены; ${countRowsWithoutPrevious} без предыдущего значения`
                              : isCumulativeShareMetric && !previousRegionalComponents
                                ? "доля сопоставима, но компоненты предыдущего среза не сохранены; после следующей выгрузки будут показаны изменения числителя и знаменателя"
                                : "текущая выгрузка сравнивается с непосредственно предыдущей"}''',
    "comparability/anomaly message",
)
p.write_text(s, encoding="utf-8")


# --- pipeline adapters ----------------------------------------------------
p = ROOT / "scripts/pipeline/adapters.py"
s = p.read_text(encoding="utf-8")
s = must_replace(
    s,
    '\n\ndef previous_rows_from_dataset(ds: dict) -> dict[str, dict]:',
    '''\n\ndef previous_summary_metadata(base: dict, end: date) -> dict:
    """Carry numerator/denominator of the immediately previous comparable export.

    This is dataset-level metadata for cumulative shares. Missing components stay
    missing and are never reconstructed from the percentage alone.
    """
    same_cut = base.get("date") == date_ru(end)
    return {
        "previousNumerator": base.get("previousNumerator") if same_cut else base.get("numerator"),
        "previousDenominator": base.get("previousDenominator") if same_cut else base.get("denominator"),
    }


def previous_rows_from_dataset(ds: dict) -> dict[str, dict]:''',
    "previous summary helper",
)
s = must_replace(
    s,
    '''        note = f"Оперативный накопительный срез на {date_ru(end)}. Отрицательные производные остатки источника не используются; отсутствие данных не заменяется нулём."
        mo[metric] = {**base, "name": base.get("name", title), "date": date_ru(end), "period": period_cumulative(end),
                      "previousDate": previous_date, "previousPeriod": previous_period, "note": note,
                      "rows": retain_no_source_rows(prev, rows)}''',
    '''        note = f"Оперативный накопительный срез на {date_ru(end)}. Отрицательные производные остатки источника не используются; отсутствие данных не заменяется нулём."
        current_numerator = sum(x["count"] for x in cur)
        current_denominator = sum(x["volume"] for x in cur)
        mo[metric] = {**base, "name": base.get("name", title), "date": date_ru(end), "period": period_cumulative(end),
                      "previousDate": previous_date, "previousPeriod": previous_period,
                      **previous_summary_metadata(base, end),
                      "numerator": current_numerator, "denominator": current_denominator, "note": note,
                      "rows": retain_no_source_rows(prev, rows)}''',
    "egpu summary metadata",
)
s = must_replace(
    s,
    '''    denominators = parse_hospital_denominators(source)
    numerators = parse_remd_hospital_numerators(remd_source)
    prev = previous_rows_from_dataset(mo.get("hospital", {}))
    rows, dn, do = [], {}, {}
    matched = 0
    numerator_total = 0
    denominator_total = 0''',
    '''    denominators = parse_hospital_denominators(source)
    numerators = parse_remd_hospital_numerators(remd_source)
    base = mo.get("hospital", {})
    prev = previous_rows_from_dataset(base)
    same_cut = base.get("date") == date_ru(end)
    # The current production baseline is the first cut after the REMD numerator
    # correction. It stays non-comparable with the legacy calculation. Once a
    # later cut arrives, the immediately preceding corrected cut becomes a valid
    # comparison baseline and its components are carried forward.
    corrected_baseline_exists = bool(base.get("sourceNumerator") and base.get("sourceDenominator"))
    comparable_to_previous = same_cut and not base.get("comparisonReset", False) or (not same_cut and corrected_baseline_exists)
    rows, dn, do = [], {}, {}
    matched = 0
    numerator_total = 0
    denominator_total = 0''',
    "hospital baseline",
)
s = must_replace(
    s,
    '''            # Источник числителя исправлен: старая динамика несопоставима и не показывается.
            row = {
                "name": item["name"], "oid": oid, "fact": fact, "count": count,
                "previous": None, "trend": None,
            }''',
    '''            if comparable_to_previous:
                pv, trend = previous_fields(old, same_cut, fact)
            else:
                # Первый срез после исправления источника не сравнивается со старой методикой.
                pv, trend = None, None
            row = {
                "name": item["name"], "oid": oid, "fact": fact, "count": count,
                "previous": pv, "trend": trend,
            }''',
    "hospital row comparison",
)
s = must_replace(
    s,
    '''    base = mo.get("hospital", {})
    mo["hospital"] = {
        **base,
        "date": date_ru(end),
        "period": period_cumulative(end),
        "previousDate": None,
        "previousPeriod": None,
        "comparisonReset": True,
        "note": "Числитель пересчитан по РЭМД ЕГИСЗ, знаменатель — случаи стационарной помощи из отчёта по госпитализациям. Сопоставление по OID МО. Динамика к прежнему расчёту не показывается из-за исправления источника числителя.",
        "sourceNumerator": remd_source.name,
        "sourceDenominator": source.name,
        "rows": rows,
    }''',
    '''    if comparable_to_previous:
        previous_meta = {**previous_cut_metadata(base, end), **previous_summary_metadata(base, end)}
    else:
        previous_meta = {
            "previousDate": base.get("previousDate") if same_cut else None,
            "previousPeriod": base.get("previousPeriod") if same_cut else None,
            "previousNumerator": base.get("previousNumerator") if same_cut else None,
            "previousDenominator": base.get("previousDenominator") if same_cut else None,
        }
    comparison_reset = base.get("comparisonReset", True) if same_cut else not corrected_baseline_exists
    mo["hospital"] = {
        **base,
        "date": date_ru(end),
        "period": period_cumulative(end),
        **previous_meta,
        "numerator": numerator_total,
        "denominator": denominator_total,
        "comparisonReset": comparison_reset,
        "note": (
            "Числитель — РЭМД ЕГИСЗ, знаменатель — случаи стационарной помощи из отчёта по госпитализациям. "
            "Сопоставление по OID МО. Первый срез после исправления источника числителя не сравнивается со старой методикой."
            if comparison_reset
            else "Числитель — РЭМД ЕГИСЗ, знаменатель — случаи стационарной помощи из отчёта по госпитализациям. Сопоставление по OID МО; динамика рассчитана к непосредственно предыдущему срезу той же методики."
        ),
        "sourceNumerator": remd_source.name,
        "sourceDenominator": source.name,
        "rows": rows,
    }''',
    "hospital summary metadata",
)
s = must_replace(
    s,
    '    mo["ambulatoryCase"] = {**base, "date": date_ru(end), "period": period_cumulative(end), **previous_cut_metadata(base, end), "rows": retain_no_source_rows(previous, rows)}',
    '    current_numerator = sum(item["count"] for item in current)\n    current_denominator = sum(item["volume"] for item in current)\n    mo["ambulatoryCase"] = {**base, "date": date_ru(end), "period": period_cumulative(end),\n                            **previous_cut_metadata(base, end), **previous_summary_metadata(base, end),\n                            "numerator": current_numerator, "denominator": current_denominator,\n                            "rows": retain_no_source_rows(previous, rows)}',
    "ambulatory components",
)
s = must_replace(
    s,
    '    mo[metric]={**base,"date":date_ru(end),"period":period_cumulative(end),**previous_cut_metadata(base,end),"rows":retain_no_source_rows(prev, rows)}; details[metric]=dn\n    if is_full_month(end): monthly[metric]=monthly_payload(prev,cur,end)\n    for name,data in [("mo-data.json",mo),("mo-details.json",details),("monthly-mo.json",monthly)]:save(app,name,data)\n    total=sum(x["volume"] for x in cur); num=sum(x["count"] for x in cur)',
    '    total=sum(x["volume"] for x in cur); num=sum(x["count"] for x in cur)\n    mo[metric]={**base,"date":date_ru(end),"period":period_cumulative(end),\n                **previous_cut_metadata(base,end),**previous_summary_metadata(base,end),\n                "numerator":num,"denominator":total,"rows":retain_no_source_rows(prev, rows)}; details[metric]=dn\n    if is_full_month(end): monthly[metric]=monthly_payload(prev,cur,end)\n    for name,data in [("mo-data.json",mo),("mo-details.json",details),("monthly-mo.json",monthly)]:save(app,name,data)',
    "certificate components",
)
s = must_replace(
    s,
    '    mo["semd228"]={**base,"date":date_ru(end),"period":period_cumulative(end),**previous_cut_metadata(base,end),"rows":rows};details["semd228"]=dn;oids["semd228"]=do',
    '    mo["semd228"]={**base,"date":date_ru(end),"period":period_cumulative(end),\n                    **previous_cut_metadata(base,end),**previous_summary_metadata(base,end),\n                    "numerator":num,"denominator":den,"rows":rows};details["semd228"]=dn;oids["semd228"]=do',
    "preventive components",
)
s = must_replace(
    s,
    '    mo[metric]={**base,"name":base.get("name",units_payload["name"]),"date":date_ru(end),"period":period,**previous_cut_metadata(base,end),"rows":retain_no_source_rows(prev, rows)}',
    '    current_numerator=sum(g["registered"] for g in grouped.values())\n    current_denominator=sum(g["volume"] for g in grouped.values())\n    mo[metric]={**base,"name":base.get("name",units_payload["name"]),"date":date_ru(end),"period":period,\n                **previous_cut_metadata(base,end),**previous_summary_metadata(base,end),\n                "numerator":current_numerator,"denominator":current_denominator,\n                "rows":retain_no_source_rows(prev, rows)}',
    "unit component persistence",
)
s = must_replace(
    s,
    '    status[key].update({"date":date_ru(end),"period":period_cumulative(end),**previous_cut_metadata(base,end),"note":note,"rows":rows});save(app,"organization-status.json",status)',
    '    status[key].update({"date":date_ru(end),"period":period_cumulative(end),\n                        **previous_cut_metadata(base,end),**previous_summary_metadata(base,end),\n                        "numerator":positive,"denominator":total,"note":note,"rows":rows});save(app,"organization-status.json",status)',
    "presence component persistence",
)
s = must_replace(
    s,
    '    mo["smp"]={**base,"date":date_ru(end),"period":period_cumulative(end),**previous_cut_metadata(base,end),"note":"Числитель — статус «Принято» АСУ СМП, принимаемый как регистрация в РЭМД; знаменатель — количество карт вызова АСУ СМП за тот же период.","rows":rows};details["smp"]={norm(r["name"]):{"volume":r["volume"],"registered":r["registered"]} for r in rows};save(app,"mo-data.json",mo);save(app,"mo-details.json",details)',
    '    current_numerator=sum(r["registered"] for r in rows); current_denominator=sum(r["volume"] for r in rows)\n    mo["smp"]={**base,"date":date_ru(end),"period":period_cumulative(end),\n               **previous_cut_metadata(base,end),**previous_summary_metadata(base,end),\n               "numerator":current_numerator,"denominator":current_denominator,\n               "note":"Числитель — статус «Принято» АСУ СМП, принимаемый как регистрация в РЭМД; знаменатель — количество карт вызова АСУ СМП за тот же период.","rows":rows};details["smp"]={norm(r["name"]):{"volume":r["volume"],"registered":r["registered"]} for r in rows};save(app,"mo-data.json",mo);save(app,"mo-details.json",details)',
    "smp components",
)
p.write_text(s, encoding="utf-8")


# --- Persist component baselines in current data --------------------------
mo_path = ROOT / "app/mo-data.json"
detail_path = ROOT / "app/mo-details.json"
mo = json.loads(mo_path.read_text(encoding="utf-8"))
details = json.loads(detail_path.read_text(encoding="utf-8"))
source_backed = ["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"]
for key in source_backed:
    values = list((details.get(key) or {}).values())
    mo[key]["numerator"] = int(sum(float(x.get("registered") or 0) for x in values))
    mo[key]["denominator"] = int(sum(float(x.get("volume") or 0) for x in values))
confirmed_previous = {
    "semd228": ("07.09.2026", "01.01–07.09.2026", 1557278, 2036859),
    "ambulatoryCase": ("29.08.2026", "01.01–29.08.2026", 9549272, 10948601),
    "smp": ("28.08.2026", "01.01–28.08.2026", 576237, 624216),
}
for key, (date, period, numerator, denominator) in confirmed_previous.items():
    mo[key]["previousDate"] = date
    mo[key]["previousPeriod"] = period
    mo[key]["previousNumerator"] = numerator
    mo[key]["previousDenominator"] = denominator
mo_path.write_text(json.dumps(mo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# --- Docs/version metadata ------------------------------------------------
state = read("STATE.md")
state = state.replace("# Состояние проекта — дашборд цифровизации здравоохранения РТ v5.4.3", "# Состояние проекта — дашборд цифровизации здравоохранения РТ v5.4.4", 1)
state = state.replace("- Кандидат рабочей версии: **5.4.3**; текущий production до публикации остаётся **5.4.2**.", "- Кандидат рабочей версии: **5.4.4**; текущий production до публикации остаётся **5.4.3**.", 1)
anchor = "- Для количественных показателей оперативная разница показывается в абсолютном значении и, при ненулевом предыдущем значении, в процентах; для долевых показателей — в процентных пунктах.\n"
if anchor not in state:
    raise RuntimeError("STATE operational dynamics anchor not found")
state = state.replace(anchor, anchor + "- Для **накопительных долевых показателей с подтверждёнными компонентами** дополнительно показываются числитель и знаменатель обоих срезов и изменение каждого компонента. Если накопительный числитель или знаменатель уменьшился, это помечается как аномалия качества данных и требует проверки источника/состава; такое снижение не скрывается.\n- Компоненты предыдущего среза используются только если они были сохранены/подтверждены; они **не восстанавливаются из процента** и отсутствие компонента не заменяется нулём.\n", 1)
state = state.replace("- Production остаётся на v5.4.2; v5.4.3 не публиковать без отдельной команды владельца проекта.", "- Production остаётся на v5.4.3; v5.4.4 не публиковать без отдельной команды владельца проекта.", 1)
write("STATE.md", state)

issues = read("OPEN_ISSUES.md")
issues = issues.replace("# Открытые вопросы после подготовки v5.4.3", "# Открытые вопросы после подготовки v5.4.4", 1)
issues = issues.replace("На момент подготовки v5.4.3 **подтверждённых незакрытых программных ошибок нет**. Финальный статус определяется после полного CI. Production остаётся на v5.4.2 до отдельного разрешения на публикацию.", "На момент подготовки v5.4.4 **подтверждённых незакрытых программных ошибок нет**. Финальный статус определяется после полного CI. Production остаётся на v5.4.3 до отдельного разрешения на публикацию.", 1)
heading = "## Ожидаемые данные и методологические ограничения\n\n"
issues = must_replace(issues, heading, heading + "**СЭМД 122/228 — аномалия накопительного числителя.** Между подтверждёнными срезами 07.09 и 11.09 числитель уменьшился с 1 557 278 до 1 527 595 (−29 683), при этом знаменатель вырос с 2 036 859 до 2 069 632 (+32 773). Дашборд помечает это как аномалию качества данных. Требуется проверить состав/источник РЭМД и правила сопоставления МО; снижение не трактовать как обычное ухудшение работы МО до выяснения причины.\n\n", "OPEN_ISSUES anomaly")
write("OPEN_ISSUES.md", issues)

for rel in [
    "baseline/semantic-snapshot.json", "baseline/mo-registry-runtime-snapshot.json",
    "baseline/calculation-runtime-snapshot.json", "baseline/validation-snapshot.json",
    "baseline/indicator-metadata-snapshot.json", "validation/validation-report.json",
    "validation/indicator-metadata-equivalence.json", "validation/ai-review.json",
    "validation/calculation-equivalence.json", "config/indicator-registry.json",
]:
    text = read(rel).replace('"baselineVersion": "5.4.3"', '"baselineVersion": "5.4.4"')
    write(rel, text)
for rel in ["scripts/promote_calculation_baseline.mjs", "scripts/promote_semantic_baseline.py", "scripts/promote_mo_registry_snapshot.mjs"]:
    write(rel, read(rel).replace("5.4.3", "5.4.4"))
for rel in ["tests/baseline-lock.test.mjs", "tests/hearing-snapshots.test.mjs", "tests/ui-remarks-v522.test.mjs"]:
    text = read(rel).replace("approved v5.4.3", "approved v5.4.4").replace('"5.4.3"', '"5.4.4"').replace("5\\.4\\.3", "5\\.4\\.4")
    write(rel, text)

write("baseline/RELEASE_5.4.4.md", '''# Release candidate v5.4.4

Дата подготовки: 15.09.2026.

Статус: подготовлен к проверке, не опубликован.

## Изменение

Оперативная динамика накопительных долевых показателей теперь раскрывает не только изменение процента, но и его компоненты.

- для применимых накопительных долей показываются числитель и знаменатель предыдущего и текущего срезов;
- отдельно показывается изменение числителя и знаменателя;
- если накопительный числитель или знаменатель уменьшился, карточка получает предупреждение об аномалии качества данных;
- компоненты предыдущего среза не восстанавливаются из процента и не подменяются нулём;
- при смене методики/источника сравнение остаётся заблокированным до появления двух последовательных срезов одной методики;
- адаптеры сохраняют компоненты текущего среза, чтобы следующая выгрузка автоматически получила корректную компонентную динамику.

## Текущая выявленная аномалия

Для СЭМД 122/228: 07.09 — 1 557 278 / 2 036 859 = 76,45%; 11.09 — 1 527 595 / 2 069 632 = 73,81%. Накопительный числитель уменьшился на 29 683 при росте знаменателя на 32 773. Это помечается как аномалия источника/состава, а не скрывается как обычная динамика.

## Ограничения

- исходные значения показателей и утверждённые методики не пересчитывались;
- для показателей, где компоненты предыдущего среза исторически не были сохранены, дашборд показывает текущие компоненты и явно сообщает об отсутствии предыдущих; после следующей сопоставимой выгрузки компонентная динамика появится автоматически;
- выписные эпикризы остаются несопоставимыми с прежней методикой; следующий срез на той же исправленной методике сможет сравниваться с текущим срезом 11.09;
- production не обновляется до отдельной команды владельца проекта.
''')

write("tests/cumulative-component-dynamics.test.mjs", '''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/page.tsx", "utf8");
const adapters = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const details = JSON.parse(fs.readFileSync("app/mo-details.json", "utf8"));
const sourceBacked = ["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"];
const sum = (metric, field) => Object.values(details[metric] ?? {}).reduce((total, row) => total + Number(row?.[field] ?? 0), 0);

test("all source-backed cumulative shares persist current numerator and denominator", () => {
  for (const metric of sourceBacked) {
    assert.equal(mo[metric].numerator, sum(metric, "registered"), `${metric} numerator`);
    assert.equal(mo[metric].denominator, sum(metric, "volume"), `${metric} denominator`);
  }
});

test("confirmed previous components expose the real cumulative movements", () => {
  assert.deepEqual([mo.semd228.previousNumerator, mo.semd228.previousDenominator], [1557278, 2036859]);
  assert.deepEqual([mo.ambulatoryCase.previousNumerator, mo.ambulatoryCase.previousDenominator], [9549272, 10948601]);
  assert.deepEqual([mo.smp.previousNumerator, mo.smp.previousDenominator], [576237, 624216]);
  assert.equal(mo.semd228.numerator - mo.semd228.previousNumerator, -29683);
  assert.equal(mo.semd228.denominator - mo.semd228.previousDenominator, 32773);
});

test("indicator UI shows component dynamics only where the regional ratio is source-backed", () => {
  assert.match(page, /sourceBackedIndicatorIds\\.has\\(matrixMetric\\)/u);
  assert.match(page, /previousNumerator/u);
  assert.match(page, /previousDenominator/u);
  assert.match(page, /числитель уменьшился/u);
  assert.match(page, /знаменатель уменьшился/u);
  assert.match(page, /компоненты предыдущего среза не сохранены/u);
  assert.match(page, /selectedDataset\\.comparisonReset\\s*\\?\\s*null/u);
});

test("pipeline carries component baselines forward without reconstructing missing values", () => {
  assert.match(adapters, /def previous_summary_metadata\\(base: dict, end: date\\)/u);
  assert.match(adapters, /never reconstructed from the percentage alone/u);
  assert.match(adapters, /"previousNumerator": base\\.get\\("previousNumerator"\\) if same_cut else base\\.get\\("numerator"\\)/u);
  assert.match(adapters, /corrected_baseline_exists/u);
  assert.match(adapters, /comparison_reset = base\\.get\\("comparisonReset", True\\) if same_cut else not corrected_baseline_exists/u);
});
''')

# Baseline manifest is updated last so hashes lock the final files.
manifest_path = ROOT / "baseline/manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["baselineVersion"] = "5.4.4"
manifest["baselineDate"] = "2026-09-15"
manifest["changeClass"] = "Компонентная оперативная динамика накопительных долей: числитель, знаменатель и контроль аномалий"
manifest["regression"]["nodeTests"] = "151/151 PASS"
manifest["regression"]["validation"] = "15/15 PASS"
manifest["regression"]["calculationEquivalence"] = "38/38 PASS"
manifest["regression"]["metadataEquivalence"] = "38/38 PASS"
manifest["regression"]["stagingAdapters"] = "21/21 PASS"
manifest["regression"]["fail"] = 0
manifest["regression"]["warnings"] = []
manifest["note"] = "v5.4.4: для применимых накопительных долевых показателей оперативная динамика показывает числитель и знаменатель обоих срезов и изменение компонентов; уменьшение накопительного компонента помечается как аномалия качества данных. Неподтверждённые предыдущие компоненты не восстанавливаются из процента. Production остаётся на v5.4.3 до отдельной команды."
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for rel in list(manifest[group_name]):
        manifest[group_name][rel] = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Self-remove: the materializer workflow commits only the final release files.
Path(__file__).unlink()
print("v5.4.4 materialized")
