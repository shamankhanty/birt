#!/usr/bin/env python3
"""Build the approved 07.09.2026 operational candidate.

The physician 500+ workbook and the misleading combined preventive workbook
are intentionally excluded. The monthly August REMD rejection workbook is
supplied separately and labelled as a monthly count, not a rejection share.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))
from adapters import (  # noqa: E402
    adapt_asu_smp,
    adapt_certificates,
    adapt_egpu,
    adapt_errors,
    adapt_fap,
    adapt_hospital,
    adapt_max,
    adapt_presence,
    adapt_preventive,
    adapt_short_input,
    adapt_tvsp_buildings,
    adapt_tvsp_subunits,
)


def one(folder: Path, fragment: str) -> Path:
    matches = [p for p in folder.iterdir() if fragment.casefold() in p.name.casefold()]
    if len(matches) != 1:
        raise RuntimeError(f"Ожидался один файл для {fragment!r}, найдено: {[p.name for p in matches]}")
    return matches[0]


def restore_missing_row(app: Path, previous_app: Path, metric: str, oid: str) -> None:
    current = json.loads((app / "mo-data.json").read_text(encoding="utf-8"))
    previous = json.loads((previous_app / "mo-data.json").read_text(encoding="utf-8"))
    if any(str(row.get("oid")) == oid for row in current[metric]["rows"]):
        return
    old = next(row for row in previous[metric]["rows"] if str(row.get("oid")) == oid)
    row = {**old, "previous": old.get("fact"), "trend": None,
           "sourceWarning": "Нет строки в выгрузке на 07.09.2026"}
    current[metric]["rows"].append(row)
    (app / "mo-data.json").write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("weekly", type=Path)
    parser.add_argument("august_errors", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    out = args.output
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "app", out / "app")
    app = out / "app"
    end = date(2026, 9, 7)
    results = []
    call = lambda value: results.append(value.dict())

    call(adapt_certificates(app, one(args.weekly, "Свидетельства_о_рождении"), end, "birth", "birth_certificates"))
    call(adapt_certificates(app, one(args.weekly, "Свид-ва о смерти"), end, "death", "death_certificates"))
    call(adapt_egpu(app, one(args.weekly, "ПР_2_"), end))
    call(adapt_hospital(app, one(args.weekly, "Отчет по госпитализациям"), end))
    call(adapt_max(app, one(args.weekly, "ТМК_МАХ"), end))
    call(adapt_preventive(
        app,
        one(args.weekly, "Медкнижки"),
        one(args.weekly, "Количество_СЭМД_Результаты"),
        end,
        ROOT / "app" / "mo-registry.json",
    ))
    call(adapt_tvsp_subunits(app, one(args.weekly, "Эпикриз по законч"), end, "tvspAmbulatory", "tvsp_ambulatory", "Амбулаторные ТВСП, передающие эпикриз/талон и/или протокол консультации", "объект контроля с ТВСП"))
    call(adapt_tvsp_subunits(app, one(args.weekly, "Эпикриз_в_стационаре"), end, "tvspStationary", "tvsp_stationary", "ТВСП, передающие выписные эпикризы", "объект контроля с ТВСП"))
    call(adapt_tvsp_subunits(app, one(args.weekly, "лабораторного исследования"), end, "tvspLaboratory", "tvsp_laboratory", "КДЛ, передающие протокол лабораторного исследования", "КДЛ / лаборатория"))
    call(adapt_tvsp_buildings(app, one(args.weekly, "Протокол_диагностических"), end, "tvspDiagnostic", "tvsp_diagnostic", "ТВСП, передающие протоколы диагностических исследований", "объект контроля", 8))
    call(adapt_tvsp_buildings(app, one(args.weekly, "Отчет_СМП_ТВСП"), end, "smpFederal", "smp_tvsp", "Станции и подстанции СМП, передающие карты вызова", "станция / подстанция СМП", 7))
    call(adapt_presence(app, one(args.weekly, "Отчет_ТМК_РЭМД"), end, "tmk_remd"))
    call(adapt_presence(app, one(args.weekly, "Медкнижки"), end, "elmk"))
    call(adapt_short_input(app, one(args.weekly, "Случаи краткого ввода"), end))
    call(adapt_fap(app, one(args.weekly, "Отчет_по_ФАП_и_ФП"), end))
    call(adapt_asu_smp(app, one(args.weekly, "Отправка сведений"), end))

    # The new rejection file is a complete August month, not a cumulative 07.09 slice.
    call(adapt_errors(app, args.august_errors, date(2026, 8, 31)))
    errors = json.loads((app / "error-categories.json").read_text(encoding="utf-8"))
    errors["period"] = "01.08–31.08.2026"
    errors["shareDate"] = "08.09.2026"
    errors["shareSource"] = "Доля не рассчитана: файл содержит только количество отказов за август без знаменателя всех обработанных запросов"
    errors["organizationBreakdown"]["sourcePeriod"] = "01.08–31.08.2026"
    errors["organizationBreakdown"]["sourceFormed"] = "08.09.2026"
    (app / "error-categories.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (app / "error-organizations.json").write_text(json.dumps(errors["organizationBreakdown"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Weekly source absence is explicit and never converted to zero.
    restore_missing_row(app, ROOT / "app", "tvspAmbulatory", "1.2.643.5.1.13.13.12.2.16.1202")
    restore_missing_row(app, ROOT / "app", "tvspLaboratory", "1.2.643.5.1.13.13.12.2.16.1129")
    restore_missing_row(app, ROOT / "app", "smpFederal", "1.2.643.5.1.13.13.12.2.16.1149")

    # Full-month rating and physician/500+ metrics stay on the approved August baseline.
    shutil.copy2(ROOT / "app" / "monthly-mo.json", app / "monthly-mo.json")
    shutil.copy2(ROOT / "app" / "physician-metrics.json", app / "physician-metrics.json")
    manifest = {
        "status": "PASS",
        "period": "07.09.2026",
        "excluded": ["Врачи 500+ (месячный источник)", "Комбинированный файл профилактики с фактическим окончанием 31.08.2026", "Накопительный файл отказов 01.01–07.09 (заменён августовским отчётом)"],
        "adapters": results,
    }
    (out / "selected-update-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "adapters": len(results), "output": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
