#!/usr/bin/env python3
"""Build auditable unit- and organization-level datasets from the 05.08 source pack."""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from openpyxl import load_workbook


OID_RE = re.compile(r"1\.2\.643(?:\.\d+)+")


def text(value):
    return "" if value is None else str(value).strip()


def norm(value):
    value = text(value).lower().replace("ё", "е")
    value = re.sub(r"[\"«»]", "", value)
    value = re.sub(r"^(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во)(?:\s+рт)?\s+", "", value)
    replacements = {
        "городская поликлиника": "гп", "городская клиническая больница": "гкб",
        "городская больница": "гб", "республиканская клиническая больница": "ркб",
        "республиканский клинический противотуберкулезный диспансер": "ркпд",
        "межрегиональный клинико-диагностический центр": "мкдц",
        "центральная районная больница": "црб",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    value = value.replace("г. казани", "казань").replace("г. казань", "казань")
    value = value.replace("г казани", "казань").replace("г казань", "казань")
    value = value.replace("г. наб.челны", "наб челны").replace("г. набережные челны", "наб челны")
    value = re.sub(r"\s*№\s*", "№", value)
    return re.sub(r"[^а-яa-z0-9№]+", " ", value).strip()


def rt(value):
    return text(value).startswith("Республика Татарстан")


def split_oids(value):
    return set(OID_RE.findall(text(value)))


def read_master(remd_path: Path):
    wb = load_workbook(remd_path, read_only=True, data_only=True)
    ws = wb["Отчет РЭМД по подразделениям"]
    headers = []
    last = ""
    for cell in ws[5]:
        if text(cell.value):
            last = text(cell.value)
        headers.append(last)
    units = {}
    docs = defaultdict(lambda: defaultdict(int))
    building_docs = defaultdict(lambda: defaultdict(int))
    building_names = {}
    for row in ws.iter_rows(min_row=7, values_only=True):
        if not rt(row[0]) or not text(row[2]):
            continue
        mo_oid, sp_oid = text(row[2]), text(row[3])
        building_id = text(row[5])
        if building_id:
            building_names.setdefault((mo_oid, building_id), text(row[6]) or "Наименование здания отсутствует")
        if sp_oid:
            units.setdefault(sp_oid, {"unit": text(row[4]) or "Наименование СП отсутствует", "buildingId": building_id, "building": text(row[6])})
        for idx, value in enumerate(row):
            if idx >= len(headers) or not isinstance(value, (int, float)):
                continue
            header = headers[idx]
            if sp_oid:
                docs[sp_oid][header] += int(value)
            if building_id:
                building_docs[(mo_oid, building_id)][header] += int(value)
    return units, docs, building_docs, building_names


def doc_count(doc_map, phrases):
    return sum(value for header, value in doc_map.items() if any(p.lower() in header.lower() for p in phrases))


def build_sp_dataset(path, building_docs, building_names, name, entity, phrases, expected):
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb["Детализация по СП"]
    rows = []
    for row in ws.iter_rows(min_row=7, values_only=True):
        if not rt(row[0]):
            continue
        mo, mo_oid, building_id = text(row[1]), text(row[2]), text(row[3])
        planned, passed, failed = split_oids(row[4]), split_oids(row[5]), split_oids(row[6])
        if not planned:
            continue
        rows.append({"mo": mo, "moOid": mo_oid, "unit": building_names.get((mo_oid, building_id), "Наименование объекта отсутствует в выгрузке"), "unitOid": ", ".join(sorted(planned)), "buildingIds": building_id, "registered": bool(passed), "partial": bool(passed and failed), "count": doc_count(building_docs[(mo_oid, building_id)], phrases), "plannedSubunits": len(planned), "registeredSubunits": len(planned & passed)})
    rows.sort(key=lambda r: (norm(r["mo"]), norm(r["unit"]), r["unitOid"]))
    plan, fact = len(rows), sum(r["registered"] for r in rows)
    if (plan, fact) != expected:
        raise ValueError(f"{name}: expected {expected}, got {(plan, fact)}")
    return {"name": name, "entity": entity, "plan": plan, "fact": fact, "date": "06.08.2026", "rows": rows}


def build_building_dataset(path, sheet_name, building_docs, name, entity, phrases, expected, start_row):
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_name]
    collected = {}
    for row in ws.iter_rows(min_row=start_row, values_only=True):
        if not rt(row[1]):
            continue
        mo, mo_oid, building_id, building = text(row[2]), text(row[3]), text(row[4]), text(row[5])
        key = (mo_oid, building_id)
        collected[key] = {"mo": mo, "moOid": mo_oid, "unit": building or "Наименование объекта отсутствует", "unitOid": building_id, "buildingIds": building_id, "registered": text(row[6]).lower() == "да", "count": doc_count(building_docs[key], phrases)}
    rows = sorted(collected.values(), key=lambda r: (norm(r["mo"]), norm(r["unit"]), r["unitOid"]))
    plan, fact = len(rows), sum(r["registered"] for r in rows)
    if (plan, fact) != expected:
        raise ValueError(f"{name}: expected {expected}, got {(plan, fact)}")
    return {"name": name, "entity": entity, "plan": plan, "fact": fact, "date": "06.08.2026", "rows": rows}


def source_counts(ws, name_col, oid_col, count_col, start_row):
    result = defaultdict(lambda: {"count": 0, "oid": "", "name": ""})
    for row in ws.iter_rows(min_row=start_row, values_only=True):
        if not rt(row[0]):
            continue
        n = text(row[name_col])
        if not n:
            continue
        key = norm(n)
        result[key]["name"] = n
        result[key]["oid"] = text(row[oid_col]) or result[key]["oid"]
        if isinstance(row[count_col], (int, float)):
            result[key]["count"] += int(row[count_col])
    return result


def best_match(key, source):
    if key in source:
        return source[key]
    ranked = sorted(((SequenceMatcher(None, key, candidate).ratio(), candidate) for candidate in source), reverse=True)
    if ranked and ranked[0][0] >= .67:
        return source[ranked[0][1]]
    return None


def build_presence(calcs_root: Path):
    elmk_file = next(calcs_root.glob("9 слайд (Медкнижки)*"))
    wb = load_workbook(elmk_file, read_only=True, data_only=True)
    licensed_ws, report_ws, zero_ws = wb["МО обладающие лицензией"], wb["Отчет РЭМД по МО 01.01.-06.08."], wb["Для ВКС"]
    licensed = [text(row[0]) for row in licensed_ws.iter_rows(min_row=6, values_only=True) if text(row[0])]
    zero_names = [text(row[0]) for row in zero_ws.iter_rows(min_row=6, max_row=13, values_only=True) if text(row[0])]
    licensed_keys = {norm(n): n for n in licensed}
    zero_keys = set()
    zero_warnings = {}
    for zero_name in zero_names:
        zero_key = norm(zero_name)
        if zero_key in licensed_keys:
            zero_keys.add(zero_key)
            continue
        number = re.search(r"№(\d+)", zero_key)
        candidates = [key for key in licensed_keys if number and re.search(rf"№{number.group(1)}(?:\s|$)", key)]
        if not candidates:
            candidates = list(licensed_keys)
        matched = max(candidates, key=lambda key: SequenceMatcher(None, zero_key, key).ratio())
        zero_keys.add(matched)
        zero_warnings[matched] = f"В листе «Для ВКС» указано: {zero_name}; наименование не совпадает с плановым перечнем и требует уточнения."
    counts = source_counts(report_ws, 1, 2, 3, 8)
    elmk_rows = []
    for n in licensed:
        key = norm(n)
        match = best_match(key, counts)
        registered = key not in zero_keys
        elmk_rows.append({"name": n, "oid": match["oid"] if match else "", "count": match["count"] if match else None, "fact": 100 if registered else 0, "previous": None, "trend": None, **({"sourceWarning": zero_warnings[key]} if key in zero_warnings else {})})
    if (len(elmk_rows), sum(r["fact"] > 0 for r in elmk_rows)) != (74, 66):
        raise ValueError("ELMK control total failed")

    tmk_file = next(calcs_root.glob("9 слайд Отчет_ТМК*"))
    twb = load_workbook(tmk_file, read_only=True, data_only=True)
    tws = twb["Детализированный отчет"]
    tmk_rows = []
    for row in tws.iter_rows(min_row=7, values_only=True):
        if not rt(row[1]) or not text(row[2]):
            continue
        count = int(row[4]) if isinstance(row[4], (int, float)) else 0
        tmk_rows.append({"name": text(row[2]), "oid": text(row[3]), "count": count, "fact": 100 if count > 0 else 0, "previous": None, "trend": None})
    if (len(tmk_rows), sum(r["fact"] > 0 for r in tmk_rows)) != (40, 39):
        raise ValueError(f"TMK control total failed: rows={len(tmk_rows)}, transmitting={sum(r['fact'] > 0 for r in tmk_rows)}")
    return {
        "elmk": {"name": "Доля МО, обеспечивших передачу СЭМД для подсистемы ЭЛМК", "plan": 100, "unit": "%", "date": "06.08.2026", "mode": "presence", "note": "Плановый перечень — 74 МО, обладающие лицензией; 8 МО не зарегистрировали ни одного СЭМД.", "rows": elmk_rows},
        "tmkRemd": {"name": "Доля МО, обеспечивших передачу СЭМД «Протокол телемедицинской консультации»", "plan": 100, "unit": "%", "date": "06.08.2026", "mode": "presence", "note": "План — 100%. В плановом перечне 40 МО: 39 зарегистрировали СЭМД, одна МО имеет нулевой результат.", "rows": tmk_rows},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--calcs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    remd = next(args.source.glob("1.Отчет СЭМД_РЭМД*"))
    units, docs, building_docs, building_names = read_master(remd)
    files = {
        "tvspStationary": next(args.source.glob("Отчет_Доля_ТВСП_СЭМД_Эпикриз_в_стационаре*")),
        "tvspAmbulatory": next(args.source.glob("Отчет_Доля_ТВСП_СЭМД_Эпикриз по законченному*")),
        "tvspLaboratory": next(args.source.glob("Отчет_Доля_ТВСП_СЭМД_Протокол лабораторного*")),
        "tvspDiagnostic": next(args.calcs.glob("10 слайд Доля_*")),
        "smpFederal": next(args.source.glob("Отчет_СМП_ТВСП*")),
    }
    result = {
        "tvspStationary": build_sp_dataset(files["tvspStationary"], building_docs, building_names, "ТВСП, передающие выписные эпикризы", "объект контроля с ТВСП", ["Эпикриз в стационаре выписной", "Выписной эпикриз из родильного дома"], (276, 272)),
        "tvspAmbulatory": build_sp_dataset(files["tvspAmbulatory"], building_docs, building_names, "ТВСП, передающие амбулаторные СЭМД", "объект контроля с ТВСП", ["Эпикриз по законченному случаю амбулаторный", "Талон амбулаторного пациента", "Протокол консультации"], (461, 456)),
        "tvspLaboratory": build_sp_dataset(files["tvspLaboratory"], building_docs, building_names, "КДЛ, передающие протоколы лабораторных исследований", "объект контроля КДЛ", ["Протокол лабораторного исследования"], (127, 121)),
        "tvspDiagnostic": build_building_dataset(files["tvspDiagnostic"], "Факт передачи", building_docs, "ТВСП, передающие протоколы диагностических исследований", "объект контроля", ["Протокол инструментального исследования", "Протокол диагностических исследований"], (304, 296), 8),
        "smpFederal": build_building_dataset(files["smpFederal"], "Факт передачи", building_docs, "Станции и подстанции СМП, передающие карты вызова", "станция / подстанция СМП", ["Карта вызова скорой медицинской помощи"], (69, 67), 7),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "unit-data.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "organization-status.json").write_text(json.dumps(build_presence(args.calcs), ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: {"plan": value["plan"], "fact": value["fact"]} for key, value in result.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
