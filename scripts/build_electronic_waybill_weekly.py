#!/usr/bin/env python3
"""Build comparable weekly EPL datasets from organization-level rows."""

import json
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    (
        Path("/workspace/scratch/8e713f374d53/upload/Отчёт_по_использованию_системы_с_10_08_2026_по_16_08_2026.xlsx"),
        "10.08–16.08.2026",
    ),
    (
        Path("/workspace/scratch/8e713f374d53/upload/Отчёт_по_использованию_системы_17_08_2026_по_23_08_2026 (2).xlsx"),
        "17.08–23.08.2026",
    ),
]
OUTPUT = ROOT / "app" / "electronic-waybill-weekly.json"


def number(value):
    return int(value or 0)


def extract(source: Path, period: str):
    workbook = load_workbook(source, read_only=True, data_only=True)
    ws = workbook["\u041b\u0438\u0441\u04421"]
    rows = []
    for values in ws.iter_rows(min_row=14, values_only=True):
        if not isinstance(values[0], (int, float)) or not values[1]:
            continue
        vehicles = number(values[2])
        moved = number(values[5])
        rows.append(
            {
                "sourceNumber": number(values[0]),
                "name": str(values[1]).strip(),
                "vehicles": vehicles,
                "ambulanceVehicles": number(values[3]),
                "otherVehicles": number(values[4]),
                "moved": moved,
                "movementShare": moved / vehicles * 100 if vehicles else None,
                "drivers": number(values[6]),
                "mechanics": number(values[7]),
                "medics": number(values[8]),
                "waybills": number(values[9]),
                "ambulanceWaybills": number(values[10]),
                "otherWaybills": number(values[11]),
                "driversWithWaybills": number(values[12]),
            }
        )
    detail = {
        "organizations": len(rows),
        "vehicles": sum(row["vehicles"] for row in rows),
        "vehiclesWithMovement": sum(row["moved"] for row in rows),
        "movementShare": sum(row["moved"] for row in rows) / sum(row["vehicles"] for row in rows) * 100,
        "waybills": sum(row["waybills"] for row in rows),
        "driversWithWaybills": sum(row["driversWithWaybills"] for row in rows),
        "organizationsWithMovement": sum(row["vehicles"] > 0 and row["moved"] > 0 for row in rows),
        "zeroMovementOrganizations": sum(row["vehicles"] > 0 and row["moved"] == 0 for row in rows),
        "zeroVehicleOrganizations": sum(row["vehicles"] == 0 for row in rows),
    }
    return {
        "source": source.name,
        "period": period,
        "sourceHeading": str(ws["B2"].value or ""),
        "systemSummary": {
            "organizations": number(ws["C6"].value),
            "vehicles": number(ws["C7"].value),
            "vehiclesWithWaybills": number(ws["E7"].value),
            "vehiclesWithMovement": number(ws["H7"].value),
        },
        "detail": detail,
        "rows": rows,
    }


previous, current = [extract(*item) for item in SOURCES]
payload = {
    "previous": previous,
    "current": current,
    "comparisonRule": "Недельная динамика и рейтинг рассчитаны по сумме строк детализации по организациям.",
    "periodCorrection": "Во внутреннем заголовке второго файла указано 10.07–16.08.2026; по имени файла и подтверждению владельца данных принят период 10.08–16.08.2026.",
}

OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"output": str(OUTPUT), "previous": previous["detail"], "current": current["detail"]}, ensure_ascii=False))
