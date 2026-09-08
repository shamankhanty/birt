#!/usr/bin/env python3
"""Restore an immutable baseline for every organization marked as heard."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GROUPS = [
    ("8bf4a60", "02.09.2026 12:12 МСК", {
        "context:spassk-crb", "1.2.643.5.1.13.13.12.2.16.1150",
        "1.2.643.5.1.13.13.12.2.16.1169", "1.2.643.5.1.13.13.12.2.16.1055",
        "1.2.643.5.1.13.13.12.2.16.1107",
    }),
    ("dd86ec7", "02.09.2026 15:22 МСК", {"1.2.643.5.1.13.13.12.2.16.1115"}),
    ("acde4b4", "04.09.2026 10:46 МСК", {"1.2.643.5.1.13.13.12.2.16.1155"}),
]


def old_json(commit: str, path: str):
    try:
        raw = subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return None
    return json.loads(raw)


def key(value: str) -> str:
    value = str(value or "").lower().replace("ё", "е").replace("№ ", "№")
    value = re.sub(r"\b(?:гауз|гбуз|гбу|фгбу|фгаоу|ао|ооо|чуз)\b", "", value)
    return re.sub(r"[^а-яa-z0-9]+", "", value)


def restore(commit: str, fixed_at: str, targets: set[str]) -> dict:
    registry = old_json(commit, "app/mo-registry.json")["organizations"]
    datasets = {}
    for path in ("app/mo-data.json", "app/operational-mo.json", "app/organization-status.json"):
        datasets.update(old_json(commit, path) or {})
    physician = old_json(commit, "app/physician-metrics.json") or {}
    datasets.update(physician.get("datasets", {}))
    details = old_json(commit, "app/mo-details.json") or {}
    by_oid = {str(org["oid"]): org for org in registry}
    result = {}
    for oid in targets:
        if oid == "context:spassk-crb":
            org = {"shortName": "Спасская ЦРБ", "name": "Спасская ЦРБ", "aliases": ["СПАССКАЯ ЦРБ"]}
        else:
            org = by_oid[oid]
        aliases = {key(org["name"]), key(org["shortName"]), *(key(a) for a in org.get("aliases", []))}
        metrics = {}
        for metric_id, dataset in datasets.items():
            candidates = [row for row in dataset.get("rows", []) if str(row.get("oid")) == oid]
            if not candidates:
                candidates = [row for row in dataset.get("rows", []) if key(row.get("name", "")) in aliases]
            if not candidates and oid == "context:spassk-crb":
                candidates = [row for row in dataset.get("rows", []) if "спасскаяцрб" in key(row.get("name", ""))]
            if not candidates:
                continue
            row = candidates[0]
            detail = next((v for n, v in details.get(metric_id, {}).items() if key(n) == key(row.get("name", ""))), None)
            metrics[metric_id] = {
                "name": dataset.get("name", metric_id), "fact": row.get("fact"),
                "previous": row.get("previous"), "plan": dataset.get("plan"),
                "unit": dataset.get("unit", ""), "date": dataset.get("date", ""),
                "period": dataset.get("period", dataset.get("date", "")),
                "count": row.get("count"), "volume": detail.get("volume") if detail else row.get("volume"),
            }
        if not metrics:
            raise RuntimeError(f"Не восстановлены показатели {oid} из {commit}")
        result[oid] = {"name": org["shortName"], "fixedAt": fixed_at, "sourceCommit": commit, "metrics": metrics}
    return result


payload = json.loads((ROOT / "app" / "hearing-snapshots.json").read_text(encoding="utf-8"))
for item in payload["organizations"].values():
    item.setdefault("fixedAt", payload["fixedAt"])
    item.setdefault("sourceCommit", payload["sourceCommit"])
for commit, fixed_at, targets in GROUPS:
    payload["organizations"].update(restore(commit, fixed_at, targets))
payload["note"] = "Контрольные факты восстановлены отдельно из версии проекта на момент присвоения каждой МО статуса «Заслушана»."
(ROOT / "app" / "hearing-snapshots.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"organizations": len(payload["organizations"]), "metrics": {k: len(v["metrics"]) for k, v in payload["organizations"].items()}}, ensure_ascii=False))
