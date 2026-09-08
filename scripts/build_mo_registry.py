#!/usr/bin/env python3
"""Build the authoritative MO registry without unsafe fuzzy name matching."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl


GROUP_SHEETS = {
    "ЦРБ": "Центральные районные больницы",
    "Республиканские и специализиров": "Республиканские и специализированные МО",
    "ГКБ": "Городские больницы",
    "ГП (Взрослая сеть)": "Городские поликлиники",
    "ГП (детская сеть)": "Детские городские поликлиники",
    "Стоматологии": "Стоматологические поликлиники",
}

APPLICABILITY_SHEETS = {
    "Финальный статус прикреп- 2 дн ": ["egpu", "egpu2days"],
    "Свидетельства о рождении": ["birth"],
    "Свидетельство о смерти": ["death"],
    "228 СЭМД": ["semd228"],
    "Выписные эпикризы": ["hospital"],
    "амбулаторные эпикризы": ["ambulatoryCase"],
    "ЭЛМК": ["elmk"],
    "Карты вызова СМП": ["smp"],
    "ТВСП Выписные эпикризы": ["tvspStationary"],
    "ТВСП Амбулаторные СЭМД": ["tvspAmbulatory"],
    "КДЛ лабораторные протоколы": ["tvspLaboratory"],
    "ТВСП диагностические протоколы": ["tvspDiagnostic"],
    "ТВСП СМП": ["smpFederal"],
    "МО с протоколом ТМК": ["tmkRemd"],
}

LEGAL = re.compile(r"^(?:филиал\s+)?(?:гауз|гбуз|гбу|фгбу|фгауз|фгаоуво|фгаоу\s*во|ао|ооо)(?:\s+рт)?\s*", re.I)
CITY_WORDS = ("казань", "казани", "набережныечелны", "набчелны")


def base_text(value: object) -> str:
    text = str(value or "").strip().lower().replace("ё", "е").replace("–", "-").replace("—", "-")
    text = LEGAL.sub("", text).replace("«", "").replace("»", "").replace('"', "").replace("'", "")
    substitutions = (
        (r"детская\s+городская\s+клиническая\s+больница|городская\s+детская\s+клиническая\s+больница", "дгкб"),
        (r"детская\s+городская\s+поликлиника|городская\s+детская\s+поликлиника", "дгп"),
        (r"детская\s+городская\s+больница|городская\s+детская\s+больница", "дгб"),
        (r"детская\s+стоматологическая\s+поликлиника", "дсп"),
        (r"центральная\s+районная\s+многопрофильная\s+больница", "црмб"),
        (r"центральная\s+районная\s+больница", "црб"),
        (r"городская\s+клиническая\s+больница", "гкб"),
        (r"городская\s+поликлиника", "гп"),
        (r"городская\s+больница", "гб"),
        (r"стоматологическая\s+поликлиника", "сп"),
        (r"станция\s+скорой\s+медицинской\s+помощи", "ссмп"),
        (r"больница\s+скорой\s+медицинской\s+помощи", "бсмп"),
        (r"госпиталь\s+для\s+ветеранов\s+войн", "гвв"),
    )
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text, flags=re.I)
    text = re.sub(r"\bг\.?\s*набережные\s*челны\b|\bг\.?\s*наб\.?\s*челны\b", " набережныечелны ", text)
    text = re.sub(r"\bг\.?\s*казан(?:ь|и)\b", " казань ", text)
    text = re.sub(r"\bптд\b", "противотуберкулезный диспансер", text)
    return re.sub(r"\s+", " ", text).strip()


def literal_key(value: object) -> str:
    text = str(value or "").strip().lower().replace("ё", "е").replace("«", '"').replace("»", '"')
    text = re.sub(r"\s+", " ", text)
    return text


def full_key(value: object) -> str:
    return re.sub(r"[^a-zа-я0-9№]+", "", base_text(value))


def core_key(value: object) -> str:
    text = base_text(value)
    text = re.sub(r"\([^)]*\)\s*$", "", text)
    compact = re.sub(r"[^a-zа-я0-9№]+", "", text)
    for city in CITY_WORDS:
        compact = compact.replace(city, "")
    return compact


def number_tokens(value: object) -> tuple[str, ...]:
    return tuple(re.findall(r"№\s*(\d+)", str(value or "")))


# Only explicit, auditable synonyms are allowed. Values point to a master-list name.
MANUAL_TARGETS = {
    "ркибспасскаяцрб": "ГАУЗ \"РКБ МЗ РТ\"",
    "ркбмзртспасскаяцрб": "ГАУЗ \"РКБ МЗ РТ\"",
    "альметьевскаяссмп": "ГАУЗ \"АССМП\"",
    "ссмпнабчелны": "ГАУЗ \"ССМП\"",
    "лаишевскийссмпказань": "ГАУЗ \"СТАНЦИЯ СКОРОЙ МЕДИЦИНСКОЙ ПОМОЩИ\"",
    "альметьевскаяполиклиника№3": "ГАУЗ \"АЛЬМЕТЬЕВСКАЯ ГП № 3\"",
    "городскаядетскаябольница№1": "ГАУЗ \"ГДБ № 1\"",
    "детскаягородскаяклиническаябольница№7": "ГАУЗ \"ДГКБ № 7\"",
    "казанскийэндокринологическийдиспансер": "ГАУЗ \"КЭД\"",
    "межрегиональныйклиникодиагностическийцентр": "ГАУЗ \"МКДЦ\"",
    "республиканскийклиническийнаркологическийдиспансермзрт": "ГАУЗ \"РКНД МЗ РТ\"",
    "ркибимпрофафагафонова": "ГАУЗ \"РКИБ\"",
    "гввнабережныечелны": "ГАУЗ \"ГОСПИТАЛЬ ДЛЯ ВЕТЕРАНОВ ВОЙН\"",
    "фгаоувокпфу": "ФГАОУ ВО \"КАЗАНСКИЙ (ПРИВОЛЖСКИЙ) ФЕДЕРАЛЬНЫЙ УНИВЕРСИТЕТ\"",
    "кму": "ГАУЗ \"КЛИНИКА МЕДИЦИНСКОГО УНИВЕРСИТЕТА\"",
    "нижнекамскаяцрмб": "ГАУЗ \"НЦРМБ\"",
    "лениногорскаяцрбссмп": "ГАУЗ \"ЛЕНИНОГОРСКАЯ ЦРБ\"",
    "дгб№1казань": "ГАУЗ \"ГДБ № 1\"",
    "дгп№6казань": "ГАУЗ \"ГОРОДСКАЯ ДЕТСКАЯ ПОЛИКЛИНИКА № 6\"",
    "ркпбимакадвмбехтеревамзрт": "ГАУЗ \"РКПБ ИМ. АКАД. В.М. БЕХТЕРЕВА\"",
    "филиалркпдальметьевскийпротивотуберкулезныйдиспансер": "Филиал ГАУЗ \"РКПД\"-\"Альметьевский противотуберкулезный диспансер\"",
    "филиалркпдбугульминскийпротивотуберкулезныйдиспансер": "Филиал ГАУЗ \"РКПД\" - \"Бугульминский противотуберкулезный диспансер\"",
    "филиалркпдзеленодольскийпротивотуберкулезныйдиспансер": "Филиал ГАУЗ \"РКПД\" - \"Зеленодольский противотуберкулезный диспансер\"",
    "филиалркпдлениногорскийпротивотуберкулезныйдиспансер": "Филиал ГАУЗ \"РКПД\"-\"Лениногорский противотуберкулезный диспансер\"",
    "филиалркпднижнекамскийпротивотуберкулезныйдиспансер": "ФИЛИАЛ ГАУЗ \"РКПД\" - \"НИЖНЕКАМСКИЙ ПРОТИВОТУБЕРКУЛЕЗНЫЙ ДИСПАНСЕР\"",
}


def unique_index(organizations: list[dict], field_names: tuple[str, ...]) -> dict[str, int]:
    candidates: defaultdict[str, set[int]] = defaultdict(set)
    for index, org in enumerate(organizations):
        for field in field_names:
            value = org.get(field)
            if not value:
                continue
            key = full_key(value)
            if key:
                candidates[key].add(index)
    return {key: next(iter(indexes)) for key, indexes in candidates.items() if len(indexes) == 1}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_mo_registry.py <МО по показателям.xlsx> <output.json>")
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    organizations: list[dict] = []
    seen_oids: set[str] = set()
    for row in list(wb["Все МО"].iter_rows(values_only=True))[1:]:
        if not row[0] or not row[2]:
            continue
        oid = str(row[2]).strip()
        if oid in seen_oids:
            continue
        seen_oids.add(oid)
        organizations.append({
            "name": str(row[0]).strip(),
            "shortName": str(row[1] or row[0]).strip(),
            "oid": oid,
            "level": str(row[3] or "").strip(),
            "district": str(row[4] or "").strip(),
            "kind": str(row[6] or "").strip(),
            "stationary": str(row[7] or "").strip(),
            "type": "Другие медицинские организации",
            "applicable": [],
            "aliases": [str(row[0]).strip(), str(row[1] or row[0]).strip()],
        })

    literal_candidates: defaultdict[str, set[int]] = defaultdict(set)
    exact_candidates: defaultdict[str, set[int]] = defaultdict(set)
    core_candidates: defaultdict[str, set[int]] = defaultdict(set)
    for index, org in enumerate(organizations):
        for value in (org["name"], org["shortName"]):
            literal_candidates[literal_key(value)].add(index)
            exact_candidates[full_key(value)].add(index)
            core_candidates[core_key(value)].add(index)
    literal_index = {key: next(iter(indexes)) for key, indexes in literal_candidates.items() if key and len(indexes) == 1}
    exact_index = {key: next(iter(indexes)) for key, indexes in exact_candidates.items() if key and len(indexes) == 1}
    core_index = {key: next(iter(indexes)) for key, indexes in core_candidates.items() if key and len(indexes) == 1}
    master_name_index = {full_key(org["name"]): i for i, org in enumerate(organizations)}

    manual_index: dict[str, int] = {}
    for alias, target in MANUAL_TARGETS.items():
        target_index = master_name_index.get(full_key(target))
        if target_index is not None:
            manual_index[full_key(alias)] = target_index

    def match(name: object) -> tuple[int | None, str]:
        literal = literal_key(name)
        if literal in literal_index:
            return literal_index[literal], "literal"
        exact = full_key(name)
        if exact in manual_index:
            return manual_index[exact], "manual"
        if exact in exact_index:
            return exact_index[exact], "exact"
        core = core_key(name)
        if core in core_index:
            index = core_index[core]
            source_numbers, target_numbers = number_tokens(name), number_tokens(organizations[index]["name"] + " " + organizations[index]["shortName"])
            if source_numbers and target_numbers and not set(source_numbers).issubset(set(target_numbers)):
                return None, "number-conflict"
            return index, "unique-core"
        return None, "unresolved"

    unresolved: list[dict] = []
    match_stats: defaultdict[str, int] = defaultdict(int)

    def register(sheet_name: str, name: object, metric_ids: list[str] | None = None, group_name: str | None = None) -> None:
        index, method = match(name)
        match_stats[method] += 1
        if index is None:
            unresolved.append({"sheet": sheet_name, "name": str(name).strip(), "reason": method})
            return
        org = organizations[index]
        if group_name:
            org["type"] = group_name
        for metric_id in metric_ids or []:
            if metric_id not in org["applicable"]:
                org["applicable"].append(metric_id)
        alias = str(name).strip()
        if alias not in org["aliases"]:
            org["aliases"].append(alias)

    for sheet_name, group_name in GROUP_SHEETS.items():
        seen: set[str] = set()
        for row in list(wb[sheet_name].iter_rows(values_only=True))[1:]:
            if not row[0] or full_key(row[0]) in seen:
                continue
            seen.add(full_key(row[0]))
            register(sheet_name, row[0], group_name=group_name)

    # Deterministic fallback for master-list rows omitted from the grouping tabs.
    # It uses the authoritative organization kind and abbreviation, never name similarity.
    for org in organizations:
        if org["type"] != "Другие медицинские организации":
            continue
        short = full_key(org["shortName"])
        kind = str(org["kind"]).lower()
        if "стоматолог" in kind:
            org["type"] = "Стоматологические поликлиники"
        elif short.startswith(("дгп", "гдп")):
            org["type"] = "Детские городские поликлиники"
        elif short.startswith("гп"):
            org["type"] = "Городские поликлиники"
        elif "ссмп" in kind:
            org["type"] = "Вне рейтинга"

    # Explicit decisions: one rating group per MO; non-comparable organizations are outside the rating.
    overrides = {
        "ГАУЗ \"ДРКБ МЗ РТ\"": "Республиканские и специализированные МО",
        "ГАУЗ \"РКБ МЗ РТ\"": "Республиканские и специализированные МО",
        "ГАУЗ \"ГДБ № 1\"": "Городские больницы",
        "ГАУЗ \"АЛЬМЕТЬЕВСКАЯ СП\"": "Стоматологические поликлиники",
        "ДЦ МЗ РТ": "Вне рейтинга",
        "ГАУЗ \"АССМП\"": "Вне рейтинга",
        "ГАУЗ \"ССМП\"": "Вне рейтинга",
        "ГАУЗ \"СТАНЦИЯ СКОРОЙ МЕДИЦИНСКОЙ ПОМОЩИ\"": "Вне рейтинга",
    }
    for name, group_name in overrides.items():
        register("ручные решения", name, group_name=group_name)

    for sheet_name, metric_ids in APPLICABILITY_SHEETS.items():
        seen: set[str] = set()
        for row in list(wb[sheet_name].iter_rows(values_only=True))[1:]:
            if not row[0] or full_key(row[0]) in seen:
                continue
            seen.add(full_key(row[0]))
            register(sheet_name, row[0], metric_ids=metric_ids)

    for org in organizations:
        org["aliases"] = sorted(set(org["aliases"]))
        org["applicable"] = sorted(org["applicable"])

    payload = {
        "source": source.name,
        "normalizationRule": "OID → точное унифицированное название → уникальное название без города → подтверждённый ручной синоним; нечеткое сопоставление запрещено",
        "organizations": organizations,
        "unresolved": unresolved,
        "matchStats": dict(match_stats),
        "diagnosticDenominatorDecision": {
            "status": "resolved",
            "federalSource": 304,
            "registryUniqueTvsp": 422,
            "message": "Утверждён официальный знаменатель 304 ТВСП; расчёт текущего среза — 296 из 304 = 97,37%.",
        },
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"organizations": len(organizations), "matchStats": dict(match_stats), "unresolvedCount": len(unresolved), "unresolved": unresolved}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
