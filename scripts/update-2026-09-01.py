#!/usr/bin/env python3
"""Load the ambulatory completed-case report through 29.08.2026."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import openpyxl


ROOT = Path("/workspace/sites/rt-health-digital-dashboard")
APP = ROOT / "app"
SOURCE = Path(
    "/workspace/scratch/1f5740e14d75/upload/"
    "Отчет_по_законченному_случаю_амбулаторный_-_01.01.2026-29.08.2026.xlsx"
)


def load(name: str):
    return json.loads((APP / name).read_text(encoding="utf-8"))


def save(name: str, data):
    (APP / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def norm(value: str) -> str:
    value = str(value or "").lower().replace("ё", "е")
    value = re.sub(r'["«»]', "", value)
    value = re.sub(
        r"^(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во|ао|ооо)(?:\s+рт)?\s+", "", value
    )
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value)
    return re.sub(r"[^а-яa-z0-9№]+", " ", value).strip()


mo = load("mo-data.json")
details = load("mo-details.json")
detail_oids = load("mo-detail-oids.json")
previous_rows = mo["ambulatoryCase"]["rows"]
previous_by_name = {norm(row["name"]): row.get("fact") for row in previous_rows}
previous_by_oid = {
    str(row["oid"]): row.get("fact")
    for row in previous_rows
    if row.get("oid")
}

book = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
sheet = book["1"]
rows = []
by_name = {}
by_oid = defaultdict(lambda: {"volume": 0, "registered": 0})
blank_numerators = 0
blank_oids = 0

for source in sheet.iter_rows(min_row=5, values_only=True):
    name = str(source[0] or "").strip()
    if not name or not isinstance(source[2], (int, float)):
        continue
    oid = str(source[1] or "").strip()
    volume = int(source[2])
    numerator_blank = source[3] is None
    registered = int(source[3] or 0)
    fact = registered / volume * 100 if volume else 0
    previous = previous_by_name.get(norm(name))
    if previous is None and oid:
        previous = previous_by_oid.get(oid)
    row = {
        "name": name,
        "fact": fact,
        "count": registered,
        "previous": previous,
        "trend": None if previous is None else fact - previous,
    }
    if oid:
        row["oid"] = oid
    else:
        blank_oids += 1
        row["sourceWarning"] = "OID отсутствует в исходнике; строка сохранена по наименованию."
    if numerator_blank:
        blank_numerators += 1
        row["sourceWarning"] = (
            (row.get("sourceWarning", "") + " ")
            + "Пустой числитель в федеральном отчёте интерпретирован как отсутствие зарегистрированных СЭМД."
        ).strip()
    rows.append(row)
    value = {"volume": volume, "registered": registered}
    by_name[norm(name)] = value
    if oid:
        by_oid[oid]["volume"] += volume
        by_oid[oid]["registered"] += registered

mo["ambulatoryCase"] = {
    "name": mo["ambulatoryCase"]["name"],
    "plan": 95,
    "unit": "%",
    "date": "29.08.2026",
    "period": "01.01–29.08.2026",
    "note": (
        "Источник сформирован 31.08.2026. Случаи ПМСП, поданные на оплату, используются "
        "как согласованный рабочий знаменатель до получения отдельной выгрузки завершённых случаев. "
        "Пустой числитель в строке МО трактуется как отсутствие зарегистрированных СЭМД; строки без OID и повторяющиеся OID "
        "сохранены с предупреждением."
    ),
    "rows": rows,
}
details["ambulatoryCase"] = by_name
detail_oids["ambulatoryCase"] = dict(by_oid)

save("mo-data.json", mo)
save("mo-details.json", details)
save("mo-detail-oids.json", detail_oids)

summary = {
    "rows": len(rows),
    "volume": sum(value["volume"] for value in by_name.values()),
    "registered": sum(value["registered"] for value in by_name.values()),
    "share": sum(value["registered"] for value in by_name.values())
    / sum(value["volume"] for value in by_name.values())
    * 100,
    "blank_numerators": blank_numerators,
    "blank_oids": blank_oids,
    "duplicate_oids": len(rows) - blank_oids - len(by_oid),
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
