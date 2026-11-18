#!/usr/bin/env python3
"""Rebuild the two Incident 38 datasets from the current Excel exports.

Usage:
  python3 scripts/update_incident38_data.py --cities <cities.xlsx> --districts <districts.xlsx>

Both datasets are validated completely before either production JSON is replaced.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

SPECIALTIES = [
    {"code": "11", "name": "терапевт"},
    {"code": "13", "name": "акушер-гинеколог"},
    {"code": "25", "name": "ВОП — семейный врач (семейный врач)"},
    {"code": "14", "name": "оториноларинголог"},
    {"code": "15", "name": "офтальмолог"},
    {"code": "16", "name": "педиатр"},
    {"code": "17", "name": "психиатр детский"},
    {"code": "18", "name": "психиатр-нарколог"},
    {"code": "19", "name": "стоматолог"},
    {"code": "20", "name": "стоматолог детский"},
    {"code": "21", "name": "стоматолог-терапевт"},
    {"code": "22", "name": "фтизиатр"},
    {"code": "23", "name": "хирург"},
    {"code": "26", "name": "детский хирург"},
]
OID_RE = re.compile(r"^1\.2\.643\.5\.1\.13\.")
DATE_RE = re.compile(r"\b(\d{2}\.\d{2}\.\d{4})\b")
REORGANIZATION_CONFIG = Path(__file__).resolve().parents[1] / "config" / "mo-reorganizations.json"


def fail(message: str) -> None:
    raise ValueError(message)


def normalize(text: Any) -> str:
    return re.sub(r"[^а-яa-z0-9]+", "", str(text or "").casefold().replace("ё", "е"))


def specialty_code(title: Any) -> str:
    t = normalize(title)
    if "стоматолог" in t and "терапевт" in t:
        return "21"
    if "стоматолог" in t and "детск" in t:
        return "20"
    if "стоматолог" in t:
        return "19"
    if "психиатр" in t and "нарколог" in t:
        return "18"
    if "психиатр" in t:
        return "17"
    if "хирург" in t and "детск" in t:
        return "26"
    if "хирург" in t:
        return "23"
    if "акушер" in t and "гинеколог" in t:
        return "13"
    if "семейн" in t or t.startswith("воп"):
        return "25"
    if "отоларинголог" in t or "оториноларинголог" in t:
        return "14"
    if "офтальмолог" in t:
        return "15"
    if "педиатр" in t:
        return "16"
    if "фтизиатр" in t:
        return "22"
    if "терапевт" in t:
        return "11"
    fail(f"Unknown specialty header: {title!r}")


def number(value: Any, label: str) -> float | int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"Non-numeric value in {label}: {value!r}")
    if not math.isfinite(float(value)) or value < 0:
        fail(f"Invalid negative/non-finite value in {label}: {value!r}")
    return int(value) if float(value).is_integer() else float(value)


def parse_dates(rows: list[tuple[Any, ...]], path: Path) -> tuple[str, str, str]:
    title = " ".join(str(x) for row in rows[:8] for x in row[:8] if x)
    all_dates = DATE_RE.findall(title)
    if len(all_dates) < 2:
        fail(f"{path.name}: report and FRMR dates not found in workbook title")
    report_date = all_dates[0]
    frmo_date = all_dates[-1]
    dt = datetime.strptime(report_date, "%d.%m.%Y")
    months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
    return report_date, frmo_date, f"{dt.day} {months[dt.month - 1]} {dt.year}"


def active_predecessor_oids(report_date: str) -> set[str]:
    """Return predecessor OIDs omitted from current reports after a reorganization."""
    if not REORGANIZATION_CONFIG.exists():
        return set()
    report_dt = datetime.strptime(report_date, "%d.%m.%Y").date()
    config = json.loads(REORGANIZATION_CONFIG.read_text(encoding="utf-8"))
    excluded: set[str] = set()
    for group in config.get("groups", []):
        effective = datetime.strptime(group["effectiveDate"], "%Y-%m-%d").date()
        if report_dt >= effective:
            excluded.update(item["oldOid"] for item in group.get("predecessors", []) if item.get("oldOid"))
    return excluded


def parse_workbook(path: Path, scope: str) -> dict[str, Any]:
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        if "И_38.9" not in wb.sheetnames:
            fail(f"{path.name}: sheet И_38.9 not found")
        rows = list(wb["И_38.9"].iter_rows(values_only=True))
    finally:
        wb.close()
    # Locate the header from field names and the first organization by OID; do not rely on row number.
    header_i = next((i for i, row in enumerate(rows) if len(row) > 3 and normalize(row[1]) == "oid" and "кодмо" in normalize(row[2]) and "наименование" in normalize(row[3])), None)
    if header_i is None:
        fail(f"{path.name}: organization header (OID / код МО / наименование МО) not found")
    first_org_i = next((i for i in range(header_i + 1, len(rows)) if len(rows[i]) > 1 and isinstance(rows[i][1], str) and OID_RE.match(rows[i][1])), None)
    if first_org_i is None:
        fail(f"{path.name}: first organization OID not found")
    # Specialty labels are grouped in five columns: percentage, total norm, slots, EPGU norm, EPGU slots.
    groups: dict[str, int] = {}
    header = rows[header_i]
    for col in range(9, len(header), 5):
        title = header[col]
        if not title or str(title).startswith("#"):
            continue
        code = specialty_code(title)
        if code in groups:
            fail(f"{path.name}: duplicate specialty group {title!r}")
        groups[code] = col
    expected_codes = {item["code"] for item in SPECIALTIES}
    if set(groups) != expected_codes:
        fail(f"{path.name}: specialty set mismatch; missing={sorted(expected_codes-set(groups))}, extra={sorted(set(groups)-expected_codes)}")
    # Summary row is the closest preceding row with a declared organization count and total values.
    summary_i = next((i for i in range(first_org_i - 1, header_i, -1) if len(rows[i]) > 8 and isinstance(rows[i][3], (int, float)) and all(isinstance(rows[i][c], (int, float)) for c in (5, 6, 7, 8))), None)
    if summary_i is None:
        fail(f"{path.name}: regional summary row not found")
    org_rows = [(i, row) for i, row in enumerate(rows[first_org_i:], start=first_org_i) if len(row) > 3 and isinstance(row[1], str) and OID_RE.match(row[1])]
    oids = [row[1] for _, row in org_rows]
    if len(oids) != len(set(oids)):
        fail(f"{path.name}: duplicate OID in organization rows")
    expected_count = int(rows[summary_i][3])
    if len(org_rows) != expected_count:
        fail(f"{path.name}: summary declares {expected_count} МО, parsed {len(org_rows)}")
    report_date, frmo_date, as_of = parse_dates(rows, path)
    spec_by_code = {x["code"]: x for x in SPECIALTIES}
    orgs = []
    for row_num, row in org_rows:
        raw_name = str(row[3]).strip()
        place_match = re.search(r"\s*\(([^()]*)\)\s*$", raw_name)
        place = place_match.group(1).strip() if place_match else "Территория не указана"
        display_name = raw_name[:place_match.start()].strip() if place_match else raw_name
        detail = []
        for spec in SPECIALTIES:
            col = groups[spec["code"]]
            vals = [number(row[col + offset], f"{path.name}, row {row_num+1}, {spec['name']}") for offset in (1, 2, 3, 4)]
            detail.append({"code": spec["code"], "name": spec["name"], "norm": vals[0], "slots": vals[1], "epguNorm": vals[2], "epguSlots": vals[3]})
        orgs.append({"oid": row[1], "code": str(row[2] or ""), "name": display_name, "fullName": raw_name, "city": place, "specialties": detail})
    # Tie all four regional totals back to the source summary; do not publish a partial parse.
    summary = rows[summary_i]
    for spec in SPECIALTIES:
        col = groups[spec["code"]]
        fields = [("norm", 1), ("slots", 2), ("epguNorm", 3), ("epguSlots", 4)]
        for field, offset in fields:
            actual = [o["specialties"][next(i for i, s in enumerate(SPECIALTIES) if s["code"] == spec["code"])][field] for o in orgs]
            if any(v is None for v in actual):
                fail(f"{path.name}: missing {field} value for {spec['name']}; refusing to treat missing as zero")
            total = sum(actual)
            expected = number(summary[col + offset], f"{path.name} summary {spec['name']} {field}")
            if expected is None or abs(total - expected) > 0.02:
                fail(f"{path.name}: {spec['name']} {field} total mismatch: МО={total}, source summary={expected}")
    excluded_oids = active_predecessor_oids(report_date)
    excluded_orgs = [org for org in orgs if org["oid"] in excluded_oids]
    published_orgs = [org for org in orgs if org["oid"] not in excluded_oids]
    return {
        "source": path.name,
        "reportDate": report_date,
        "asOf": as_of,
        "frmoDate": frmo_date,
        "forwardDays": 14,
        "sourceOrgCount": expected_count,
        "orgCount": len(published_orgs),
        "excludedOrganizations": [{"oid": org["oid"], "name": org["name"]} for org in excluded_orgs],
        "specialties": SPECIALTIES,
        "orgs": published_orgs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cities", required=True, type=Path, help="Excel export for Kazan and Naberezhnye Chelny")
    parser.add_argument("--districts", required=True, type=Path, help="Excel export for district medical organizations")
    parser.add_argument("--output-dir", default="app", type=Path)
    args = parser.parse_args()
    cities = parse_workbook(args.cities, "city")
    districts = parse_workbook(args.districts, "districts")
    overlap = set(x["oid"] for x in cities["orgs"]) & set(x["oid"] for x in districts["orgs"])
    if overlap:
        fail(f"City and district files overlap by OID: {sorted(overlap)}")
    if not cities["orgs"] or not districts["orgs"]:
        fail("Both input files must contain organizations")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs = [(args.output_dir / "incident38-cities.json", cities), (args.output_dir / "incident38-districts.json", districts)]
    staged = []
    try:
        for destination, data in outputs:
            fd, temp_name = tempfile.mkstemp(prefix=destination.name, suffix=".tmp", dir=destination.parent)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
            staged.append((Path(temp_name), destination))
        for temp, destination in staged:
            os.replace(temp, destination)
    finally:
        for temp, _ in staged:
            if temp.exists():
                temp.unlink()
    print(json.dumps({"status": "PASS", "datasets": [{"file": str(path), "date": data["reportDate"], "frmoDate": data["frmoDate"], "organizations": data["orgCount"], "specialties": len(data["specialties"])} for path, data in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
