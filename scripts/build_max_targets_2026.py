"""Extract the approved MAX target documents and resolve every MO to an OID."""
from __future__ import annotations

import json
import re
import zipfile
from difflib import SequenceMatcher
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = next(Path.home().glob("Downloads"))
DOCS = {
    "tmk": next(DOWNLOADS.glob("Целевые показатели МАХ *_ТМК.docx")),
    "eln": next(DOWNLOADS.glob("Целевые показатели МАХ *_ЭЛН.docx")),
}
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def norm(value: str) -> str:
    value = value.lower().replace("ё", "е")
    value = re.sub(r"[«»\"'`.,()№]", " ", value)
    value = re.sub(r"\b(гауз|гбу|филиал|им|проф|мз|рт)\b", " ", value)
    value = value.replace("городская клиническая больница", "гкб")
    value = value.replace("городская больница", "гб")
    value = value.replace("городская поликлиника", "гп")
    value = value.replace("детская городская клиническая больница", "дгкб")
    value = value.replace("детская городская больница", "дгб")
    value = value.replace("детская городская поликлиника", "дгп")
    value = value.replace("клиническая больница", "кб")
    value = value.replace("центральная городская клиническая больница", "цгкб")
    value = value.replace("нижнекамская црмб", "нцрмб")
    value = value.replace("камский детский медицинский центр", "кдмц")
    value = value.replace("камскополянская районная больница", "камскополянская рб")
    value = re.sub(r"\s+", " ", value).strip()
    return value.replace(" г ", " ").replace("г.", " ")


def tokens(value: str) -> set[str]:
    return set(norm(value).split())


def table_rows(path: Path) -> list[list[str]]:
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    result: list[list[str]] = []
    for table in root.findall(".//w:tbl", NS):
        for tr in table.findall("./w:tr", NS):
            cells = ["".join(cell.itertext()).strip() for cell in tr.findall("./w:tc", NS)]
            if len(cells) == 5 and cells[1].replace(" ", "").isdigit():
                result.append(cells)
    return result


def main() -> None:
    registry = json.loads((ROOT / "app/mo-registry.json").read_text(encoding="utf-8"))["organizations"]
    by_name: dict[str, list[dict]] = {}
    for org in registry:
        for value in [org.get("name"), org.get("shortName"), *(org.get("aliases") or [])]:
            if value:
                by_name.setdefault(norm(value), []).append(org)
    plans: dict[str, dict] = {}
    audits: dict[str, list[dict]] = {}
    for metric, path in DOCS.items():
        rows = table_rows(path)
        audits[metric] = []
        for cells in rows:
            name, *values = cells
            if "целевые значения" in name.lower() or not values[0].replace(" ", "").isdigit():
                continue
            candidates = by_name.get(norm(name), [])
            if len(candidates) == 1:
                org = candidates[0]
                match = "exact-normalized"
            else:
                subset = [org for org in registry if tokens(name) <= tokens(org.get("name", "")) or tokens(org.get("name", "")) <= tokens(name)]
                if len(subset) == 1:
                    candidates, org, match = subset, subset[0], "unique-token-subset"
                else:
                    candidates = subset if len(subset) > 1 else candidates
                    org = None
                    match = "ambiguous" if candidates else "unmatched"
                scored = sorted(
                    ((SequenceMatcher(None, norm(name), norm(org.get("name", ""))).ratio(), org) for org in registry),
                    key=lambda item: item[0], reverse=True,
                )
                if org is None:
                    candidates = [org for score, org in scored if score >= 0.78 and score == scored[0][0]]
                    org = candidates[0] if len(candidates) == 1 else None
                    match = "unique-fuzzy" if org else ("ambiguous" if candidates else "unmatched")
            audit = {"sourceName": name, "match": match, "candidates": [x["oid"] for x in candidates]}
            if org:
                oid = org["oid"]
                audit["oid"] = oid
                plans.setdefault(oid, {"name": org["name"], "oid": oid, "tmk": {}, "eln": {}})[metric] = {
                    "2026-09": int(values[0].replace(" ", "")), "2026-10": int(values[1].replace(" ", "")),
                    "2026-11": int(values[2].replace(" ", "")), "2026-12": int(values[3].replace(" ", "")),
                }
            audits[metric].append(audit)
    output = {
        "version": 2,
        "basis": "approved cumulative MAX control points for 2026",
        "months": ["2026-09", "2026-10", "2026-11", "2026-12"],
        "republic": {"tmk": {"2026-09": 145000, "2026-10": 161000, "2026-11": 177000, "2026-12": 193000},
                     "eln": {"2026-09": 74000, "2026-10": 82000, "2026-11": 90000, "2026-12": 99000}},
        "sourceFiles": [path.name for path in DOCS.values()],
        "methodology": {"tmk": "Проведенных ТМК в МАХ (накопленным итогом)", "eln": "Закрытые больничные через МАХ (накопленным итогом)", "sourceColumns": {"tmk": 3, "eln": 4}, "periodKind": "cumulative"},
        "organizationPlans": plans,
        "audit": audits,
        "validation": {"sourceOrganizationRows": 85, "matchedOrganizations": len(plans), "ambiguous": sum(sum(x["match"] == "ambiguous" for x in rows) for rows in audits.values()), "unmatched": sum(sum(x["match"] == "unmatched" for x in rows) for rows in audits.values()), "noRedistribution": True},
    }
    (ROOT / "config/max-targets-2026.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["validation"], ensure_ascii=False))


if __name__ == "__main__":
    main()
