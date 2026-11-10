#!/usr/bin/env python3
"""Extract exact SEMD type registrations for federal contract indicators."""
import json
import sys
from pathlib import Path

import openpyxl

TYPES = {
    "11": "Медицинское заключение об отсутствии медицинских противопоказаний к исполнению обязанностей частного охранника",
    "12": "Медицинское заключение об отсутствии медицинских противопоказаний к осуществлению частной детективной деятельности",
    "13": "Сообщение об аннулировании действующего медицинского заключения об отсутствии медицинских противопоказаний к осуществлению частной детективной деятельности",
    "14": "Сообщение об аннулировании действующего медицинского заключения об отсутствии медицинских противопоказаний к исполнению обязанностей частного охранника",
}


def extract(path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[1]
    source_rows = sheet.values
    period = next(source_rows)[0]
    formed = next(source_rows)[0]
    for _ in range(2):
        next(source_rows)
    header = next(source_rows)
    columns = {}
    for identifier, title in TYPES.items():
        matches = [index for index, name in enumerate(header) if name == title]
        if len(matches) != 1:
            raise ValueError(f"{path}: type {identifier} has {len(matches)} matching columns")
        columns[identifier] = matches[0]
    next(source_rows)  # document format
    next(source_rows)  # totals
    per_type = {identifier: {} for identifier in TYPES}
    for row in source_rows:
        if row[0] != "Республика Татарстан":
            continue
        for identifier, column in columns.items():
            count = row[column]
            if isinstance(count, (int, float)) and count > 0:
                oid = row[2]
                if not isinstance(oid, str) or oid in per_type[identifier]:
                    raise ValueError(f"{path}: missing or duplicate OID {oid}")
                per_type[identifier][oid] = {"oid": oid, "name": row[1], "count": int(count)}
    return period, formed, per_type


def main(previous, current, summary, output):
    previous_period, previous_formed, older = extract(previous)
    current_period, current_formed, newer = extract(current)
    regional = {item["name"]: item["count"] for item in json.loads(Path(summary).read_text())["items"]}
    items = []
    for identifier, title in TYPES.items():
        old, new = older[identifier], newer[identifier]
        if sum(entry["count"] for entry in new.values()) != regional[title]:
            raise ValueError(f"{identifier}: per-MO total differs from regional summary")
        organizations = []
        for oid in sorted(set(old) | set(new)):
            before, after = old.get(oid), new.get(oid)
            previous_count, current_count = before["count"] if before else 0, after["count"] if after else 0
            organizations.append({"oid": oid, "name": (after or before)["name"],
                                  "previous": previous_count, "current": current_count,
                                  "change": current_count - previous_count})
        items.append({"agreementId": identifier, "semdName": title,
                      "previous": sum(entry["count"] for entry in old.values()),
                      "current": sum(entry["count"] for entry in new.values()),
                      "organizations": sorted(organizations, key=lambda entry: (-entry["current"], entry["name"]))})
    result = {"source": "РЭМД ЕГИСЗ, отчёт СЭМД по МО (Республика Татарстан)",
              "previousPeriod": previous_period, "previousFormed": previous_formed,
              "currentPeriod": current_period, "currentFormed": current_formed,
              "datePrecision": "Точная дата регистрации отдельного СЭМД в этих отчётах отсутствует; сравнение накопительных срезов устанавливает интервал прироста.",
              "items": items}
    Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: script.py PREVIOUS_XLSX CURRENT_XLSX SEMD_SUMMARY_JSON OUTPUT_JSON")
    main(*sys.argv[1:])
