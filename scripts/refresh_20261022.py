#!/usr/bin/env python3
"""Apply the validated 22 October archive staging candidate without publishing."""
from __future__ import annotations
import argparse, hashlib, json, re, shutil
from collections import defaultdict
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]

def read(path): return json.loads(path.read_text(encoding="utf-8-sig"))
def write(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+"\n", encoding="utf-8", newline="\n")
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def metric(manifest, name): return next(x for x in manifest["indicators"] if x["metric"] == name)

def semd_summary(source):
    ws = openpyxl.load_workbook(source, read_only=True, data_only=True)["Отчет РЭМД"]
    rows = list(ws.values)
    heading = str(rows[0][0]); formed = str(rows[1][0]).split(": ", 1)[1]
    dates = re.findall(r"\d{2}\.\d{2}\.\d{4}", heading)
    assert dates == ["01.01.2026", "22.10.2026"], dates
    names, formats, values = rows[4], rows[5], rows[7]
    grouped = defaultdict(lambda: {"count": 0, "formats": []}); last = ""
    for index in range(3, len(values)):
        if names[index]: last = str(names[index]).strip()
        if not last: continue
        value = values[index]
        if value is None and names[index] is None and formats[index] is None: continue
        assert isinstance(value, (int, float)) and value >= 0, (index, last, value)
        grouped[last]["count"] += int(value)
        fmt = formats[index]
        if fmt and str(fmt) not in grouped[last]["formats"]: grouped[last]["formats"].append(str(fmt))
    summary = {
        "period": "–".join(dates), "formed": formed, "source": source.name,
        "total": int(values[2]), "registeredTypes": int(values[1]),
        "items": [{"name": key, "count": value["count"], "format": " / ".join(value["formats"]) or "—"} for key, value in grouped.items()],
    }
    assert sum(x["count"] for x in summary["items"]) == summary["total"]
    assert sum(x["count"] > 0 for x in summary["items"]) == summary["registeredTypes"]
    return summary

def update_federal(summary):
    control = read(ROOT/"app/federal-control.json")
    exact = {"37": "Экстренное извещение об инфекционном заболевании", "38": "Выписка из протокола решения врачебной комиссии", "39": "Льготный рецепт"}
    for row_id, needle in exact.items():
        matches = [x for x in summary["items"] if (x["name"].casefold() == needle.casefold() if row_id == "38" else x["name"].casefold().startswith(needle.casefold()))]
        assert len(matches) == 1, (row_id, matches)
        row = next(x for x in control["agreement"] if x["id"] == row_id)
        row.update(regionalFact=f"{matches[0]['count']:,} СЭМД".replace(",", "\u00a0"), regionalPeriod="01.01–22.10.2026", regionalManualStatus="achieved", status="Достигнут", sourceNote=f"Источник: накопительная выгрузка РЭМД {summary['source']}, 01.01–22.10.2026. Передача СЭМД подтверждена. Статус «Достигнут» установлен по управленческому решению 14.10.2026; автоматизированный способ формирования отдельно не верифицирован.")
    for row_id, needle in [("39.1", "Льготный рецепт"), ("39.2", "Рецепт на лекарственный препарат")]:
        match = next(x for x in summary["items"] if x["name"].startswith(needle))
        row = next(x for x in control["agreement"] if x["id"] == row_id)
        row.update(regionalFact=f"{match['count']:,} СЭМД".replace(",", " "), regionalPeriod="01.01–22.10.2026", sourceNote=f"Источник: {summary['source']}, лист «Отчет РЭМД». Подтвержденное количество зарегистрированных СЭМД за 01.01–22.10.2026.")
    write(ROOT/"app/federal-control.json", control)

def update_max_views(archive, monthly_previous, cumulative_previous):
    import sys
    sys.path.insert(0, str(ROOT/"scripts/pipeline"))
    from adapters import parse_max, source_rows
    cumulative = next(archive.glob("ТМК_МАХ 01.01.-22.10*.xlsx"))
    current = next(archive.glob("ТМК_МАХ 01.10.-22.10*.xlsx"))
    assert monthly_previous.is_file(), monthly_previous
    assert cumulative_previous.is_file(), cumulative_previous
    targets = read(ROOT/"config/max-targets-2026.json")
    old = read(ROOT/"app/max-period-views.json")
    def idx(path, metric_id, col): return {x.get("oid") or x["name"]: x for x in source_rows(parse_max(path, col), metric_id)}
    out = {**old, "month": "2026-10", "monthLabel": "Октябрь 2026"}
    out["cumulative"] = {**old["cumulative"], "date": "22.10.2026", "period": "01.01–22.10.2026", "previousDate": "13.10.2026", "previousPeriod": "01.01–13.10.2026", "source": cumulative.name, "previousSource": cumulative_previous.name, "metrics": {}}
    out["operational"] = {**old["operational"], "date": "22.10.2026", "period": "01.10–22.10.2026", "previousDate": "14.10.2026", "previousPeriod": "01.10–14.10.2026", "source": current.name, "previousSource": monthly_previous.name, "metrics": {}}
    for service, (metric_id, col) in {"tmk": ("tmkMaxCount", 3), "eln": ("elnMaxCount", 4)}.items():
        ci, cpi = idx(cumulative, metric_id, col), idx(cumulative_previous, metric_id, col)
        mi, pi = idx(current, metric_id, col), idx(monthly_previous, metric_id, col)
        cr, mr = [], []
        for oid, target in targets["organizationPlans"].items():
            c, cumulative_previous_row = ci.get(oid), cpi.get(oid)
            m, previous = mi.get(oid), pi.get(oid)
            cumulative_plan = target[service]["2026-10"]
            monthly_plan = cumulative_plan - target[service]["2026-09"]
            cr.append({"name": target["name"], "oid": oid, "fact": c.get("fact") if c else None, "previous": cumulative_previous_row.get("fact") if cumulative_previous_row else None, "plan": cumulative_plan})
            mr.append({"name": target["name"], "oid": oid, "fact": m.get("fact") if m else None, "previous": previous.get("fact") if previous else None, "plan": monthly_plan})
        out["cumulative"]["metrics"][service] = {"sourceTotal": sum(x["count"] for x in parse_max(cumulative, col)), "previousSourceTotal": sum(x["count"] for x in parse_max(cumulative_previous, col)), "plannedMoFact": sum(x["fact"] for x in cr if x["fact"] is not None), "previousPlannedMoFact": sum(x["previous"] for x in cr if x["previous"] is not None), "republicPlan": targets["republic"][service]["2026-10"], "rows": cr}
        out["operational"]["metrics"][service] = {"sourceTotal": sum(x["count"] for x in parse_max(current, col)), "previousSourceTotal": sum(x["count"] for x in parse_max(monthly_previous, col)), "plannedMoFact": sum(x["fact"] for x in mr if x["fact"] is not None), "previousPlannedMoFact": sum(x["previous"] for x in mr if x["previous"] is not None), "republicPlan": targets["republic"][service]["2026-10"]-targets["republic"][service]["2026-09"], "rows": mr}
    write(ROOT/"app/max-period-views.json", out)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--full-stage", type=Path, required=True)
    parser.add_argument("--weekly-errors-stage", type=Path, required=True)
    parser.add_argument("--cumulative-errors-stage", type=Path, required=True)
    parser.add_argument("--max-monthly-previous", type=Path, required=True)
    parser.add_argument("--max-cumulative-previous", type=Path, required=True)
    args = parser.parse_args()
    manifest = read(args.full_stage/"staging-manifest.json")
    assert manifest["formalValidation"]["summary"]["FAIL"] == 0
    assert all(metric(manifest, x)["state"] in ("PREPARED", "UNCHANGED") for x in ["egpu", "egpu2days", "hospital", "ambulatoryCase", "semd228", "birth", "death", "tmkMaxCount", "elnMaxCount", "tvspAmbulatory", "tvspStationary", "tvspLaboratory", "tvspDiagnostic", "smpFederal", "tmkRemd", "elmk", "shortInput", "shortInputAmb", "shortInputHosp", "fapSemdCount", "smp"])
    for name in manifest["changedFiles"]: shutil.copy2(args.full_stage/"app"/name, ROOT/"app"/name)
    weekly = read(args.weekly_errors_stage/"staging-manifest.json"); assert metric(weekly, "remdErrors")["state"] == "PREPARED"
    for name in ("error-categories.json", "error-organizations.json"): shutil.copy2(args.weekly_errors_stage/"app"/name, ROOT/"app"/name)
    weekly_payload = read(ROOT/"app/error-categories.json"); weekly_payload["periodKind"] = "weekly"; write(ROOT/"app/error-categories.json", weekly_payload)
    cumulative = read(args.cumulative_errors_stage/"staging-manifest.json"); assert metric(cumulative, "remdErrors")["state"] == "PREPARED"
    cumulative_payload = read(args.cumulative_errors_stage/"app/error-categories.json")
    cumulative_payload["periodKind"] = "cumulative"
    cumulative_payload["organizationBreakdown"] = read(args.cumulative_errors_stage/"app/error-organizations.json")
    assert cumulative_payload["period"] == "01.01.2026–22.10.2026"
    write(ROOT/"app/error-cumulative.json", cumulative_payload)
    source = next(args.archive.glob("1.Отчет СЭМД_РЭМД - 01.01.-22.10*.xlsx"))
    summary = semd_summary(source); write(ROOT/"app/semd-summary.json", summary); update_federal(summary)
    update_max_views(args.archive, args.max_monthly_previous, args.max_cumulative_previous)
    evidence = {
        "checkedAt": "22.10.2026", "sourceFiles": {p.name: sha(p) for p in sorted(args.archive.glob("*.xlsx"))},
        "statistics": manifest["statistics"], "prepared": [x["metric"] for x in manifest["indicators"] if x["state"] == "PREPARED"],
        "unchanged": [x["metric"] for x in manifest["indicators"] if x["state"] == "UNCHANGED"],
        "separatelyPrepared": ["remdErrorsWeekly", "remdErrorsCumulative", "semdSummary", "maxPeriodViews", "federalRemdFacts"],
        "retained": [{"metric": "electronicWaybill", "reason": "Источник отсутствует в архиве; сохранен предыдущий подтвержденный срез."}],
        "sourceCorrections": [{"metric": "shortInput", "rule": "Строки с одинаковым OID агрегированы; отсутствие данных не заменяется нулем.", "duplicateOids": ["1.2.643.5.1.13.13.12.2.16.15115", "1.2.643.5.1.13.13.12.2.16.9252"]}],
        "semdSummary": {k: summary[k] for k in ("period", "formed", "total", "registeredTypes")},
    }
    write(ROOT/"docs/update-20261022-evidence.json", evidence)
    (ROOT/"docs/update-20261022.md").write_text("# Обновление данных 22.10.2026\n\n- Проверены 22 Excel-файла архива.\n- ЕПГУ: два независимых показателя, накопительный срез 01.01–22.10 и полный сентябрь.\n- Подготовлены все поступившие показатели; ошибки РЭМД разделены на накопительный и оперативный периоды.\n- Краткий ввод: повторные строки одного OID агрегированы.\n- ЭПЛ: нового источника нет, предыдущий подтвержденный срез сохранен.\n- Октябрьские данные врачей остаются оперативными и не заменяют полный сентябрь в месячном рейтинге.\n", encoding="utf-8", newline="\n")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))

if __name__ == "__main__": main()
