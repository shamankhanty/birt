#!/usr/bin/env python3
"""Build the Татарстан GIS OMS drilldown from the federal MO workbook."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from openpyxl import load_workbook


INDICATORS = {
    "1.2": {
        "name": "Взаимодействие с ГИС ОМС",
        "plan": 5,
        "fact": 25,
        "volume": None,
    },
    "1.2.1": {
        "name": "Идентификация застрахованных лиц через ФЕРЗЛ",
        "plan": 6,
        "fact": 7,
        "volume": 8,
    },
    "1.2.2": {
        "name": "Передача сведений о прикреплении через ФЕРЗЛ",
        "plan": 9,
        "fact": 10,
        "volume": 11,
    },
    "1.2.3": {
        "name": "Передача в ФПУМП не менее 100 медицинских услуг",
        "plan": 13,
        "fact": 23,
        "volume": 24,
    },
}


def build(source: Path) -> dict:
    workbook = load_workbook(source, read_only=True, data_only=True)
    sheet = workbook["Детализация по МО"]
    source_rows = [
        row
        for row in sheet.iter_rows(min_row=6, values_only=True)
        if row[0] == "Республика Татарстан"
    ]

    indicators = {}
    for indicator_id, config in INDICATORS.items():
        rows = []
        for source_row in source_rows:
            if source_row[config["plan"]] != 1:
                continue
            fact = int(source_row[config["fact"]] or 0)
            volume_index = config["volume"]
            volume = int(source_row[volume_index] or 0) if volume_index is not None else None
            rows.append(
                {
                    "oid": str(source_row[1]).strip(),
                    "name": str(source_row[3]).strip(),
                    "fullName": str(source_row[2]).strip(),
                    "achieved": fact == 1,
                    "volume": volume,
                }
            )
        rows.sort(key=lambda row: (row["achieved"], row["name"].casefold(), row["oid"]))
        achieved = sum(row["achieved"] for row in rows)
        indicators[indicator_id] = {
            "name": config["name"],
            "numerator": achieved,
            "denominator": len(rows),
            "rows": rows,
        }

    return {
        "source": source.name,
        "period": "01.07–30.09.2026",
        "subject": "Республика Татарстан",
        "indicators": indicators,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = build(args.source)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
