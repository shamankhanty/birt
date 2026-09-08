#!/usr/bin/env python3
"""Restore the immutable hearing baseline from the commit that marked five MOs heard."""

import json
import re
import subprocess
from pathlib import Path

COMMIT = "d85b4ca7de2d977ebfb884f362057fa2e9501215"
FIXED_AT = "25.08.2026 14:13 МСК"
TARGET_OIDS = {
    "1.2.643.5.1.13.13.12.2.16.1161",
    "1.2.643.5.1.13.13.12.2.16.1149",
    "1.2.643.5.1.13.13.12.2.16.44921",
    "1.2.643.5.1.13.13.12.2.16.1088",
    "1.2.643.5.1.13.13.12.2.16.1133",
}
ROOT = Path(__file__).resolve().parents[1]


def old_json(path: str):
    raw = subprocess.check_output(["git", "show", f"{COMMIT}:{path}"], cwd=ROOT)
    return json.loads(raw)


def key(value: str) -> str:
    value = value.lower().replace("ё", "е").replace("№ ", "№")
    value = re.sub(r"\b(?:гауз|гбуз|гбу|фгбу|фгаоу|ао|ооо|чуз)\b", "", value)
    return re.sub(r"[^а-яa-z0-9]+", "", value)


registry = old_json("app/mo-registry.json")["organizations"]
datasets = {}
for path in ("app/mo-data.json", "app/operational-mo.json", "app/organization-status.json"):
    datasets.update(old_json(path))
details = old_json("app/mo-details.json")

organizations = {}
for org in registry:
    if org["oid"] not in TARGET_OIDS:
        continue
    aliases = {key(org["name"]), key(org["shortName"]), *(key(a) for a in org.get("aliases", []))}
    metrics = {}
    for metric_id, dataset in datasets.items():
        candidates = [row for row in dataset.get("rows", []) if row.get("oid") == org["oid"]]
        if not candidates:
            candidates = [row for row in dataset.get("rows", []) if key(row.get("name", "")) in aliases]
        if not candidates:
            continue
        row = candidates[0]
        metric_details = details.get(metric_id, {})
        detail = next((value for name, value in metric_details.items() if key(name) == key(row.get("name", ""))), None)
        metrics[metric_id] = {
            "name": dataset.get("name", metric_id),
            "fact": row.get("fact"),
            "previous": row.get("previous"),
            "plan": dataset.get("plan"),
            "unit": dataset.get("unit", ""),
            "date": dataset.get("date", ""),
            "period": dataset.get("period", dataset.get("date", "")),
            "count": row.get("count"),
            "volume": detail.get("volume") if detail else row.get("volume"),
        }
    organizations[org["oid"]] = {"name": org["shortName"], "metrics": metrics}

missing = TARGET_OIDS - organizations.keys()
if missing:
    raise SystemExit(f"Не найдены МО: {sorted(missing)}")
if any(not item["metrics"] for item in organizations.values()):
    raise SystemExit("У одной из заслушанных МО не восстановлены показатели")

payload = {
    "fixedAt": FIXED_AT,
    "sourceCommit": COMMIT,
    "note": "Восстановлено из версии проекта, в которой пяти МО впервые присвоен статус «Заслушана».",
    "organizations": organizations,
}
(ROOT / "app" / "hearing-snapshots.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps({oid: len(item["metrics"]) for oid, item in organizations.items()}, ensure_ascii=False))
