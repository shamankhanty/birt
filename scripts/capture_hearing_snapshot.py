#!/usr/bin/env python3
"""Append one immutable hearing snapshot from a historical Git commit."""

import argparse
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = ROOT / "app" / "hearing-snapshots.json"


def historical_json(commit: str, path: str, required: bool = True):
    result = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        if required:
            raise SystemExit(result.stderr.decode("utf-8", errors="replace"))
        return {}
    return json.loads(result.stdout)


def normalized(value: str) -> str:
    value = str(value or "").lower().replace("ё", "е").replace("№ ", "№")
    value = re.sub(r"\b(?:гауз|гбуз|гбу|фгбу|фгаоу|ао|ооо|чуз)\b", "", value)
    return re.sub(r"[^а-яa-z0-9]+", "", value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--oid", required=True)
    parser.add_argument("--fixed-at", required=True)
    args = parser.parse_args()

    snapshots = json.loads(SNAPSHOTS.read_text(encoding="utf-8"))
    if args.oid in snapshots["organizations"]:
        raise SystemExit(f"Снимок для {args.oid} уже существует")

    registry = historical_json(args.commit, "app/mo-registry.json")["organizations"]
    organization = next((item for item in registry if item["oid"] == args.oid), None)
    if not organization:
        raise SystemExit(f"OID {args.oid} не найден в историческом реестре")

    aliases = {
        normalized(organization.get("name")),
        normalized(organization.get("shortName")),
        *(normalized(item) for item in organization.get("aliases", [])),
    }
    datasets = {}
    for path in ("app/mo-data.json", "app/operational-mo.json", "app/organization-status.json"):
        datasets.update(historical_json(args.commit, path))
    datasets.update(historical_json(args.commit, "app/physician-metrics.json").get("datasets", {}))
    details_by_name = historical_json(args.commit, "app/mo-details.json", required=False)
    details_by_oid = historical_json(args.commit, "app/mo-detail-oids.json", required=False)

    metrics = {}
    for metric_id, dataset in datasets.items():
        rows = dataset.get("rows", []) if isinstance(dataset, dict) else []
        candidates = [row for row in rows if row.get("oid") == args.oid]
        if not candidates:
            candidates = [row for row in rows if normalized(row.get("name")) in aliases]
        if not candidates:
            continue
        if len(candidates) > 1:
            raise SystemExit(f"{metric_id}: найдено {len(candidates)} строк для {organization['shortName']}")
        row = candidates[0]
        detail = details_by_oid.get(metric_id, {}).get(args.oid)
        if detail is None:
            detail = next(
                (
                    value
                    for name, value in details_by_name.get(metric_id, {}).items()
                    if normalized(name) == normalized(row.get("name"))
                ),
                None,
            )
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

    if not metrics:
        raise SystemExit("Не найдены показатели для снимка")
    snapshots["organizations"][args.oid] = {
        "name": organization["shortName"],
        "fixedAt": args.fixed_at,
        "sourceCommit": args.commit,
        "metrics": metrics,
    }
    SNAPSHOTS.write_text(
        json.dumps(snapshots, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"oid": args.oid, "metrics": len(metrics)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
