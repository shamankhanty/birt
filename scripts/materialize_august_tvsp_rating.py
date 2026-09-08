#!/usr/bin/env python3
"""Freeze the approved August TVSP rating rows before operational September updates."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = "9c63e05da03481d36bec373105893ffe2b85f28f"
raw = subprocess.check_output(["git", "show", f"{SOURCE_COMMIT}:app/mo-data.json"], cwd=ROOT)
baseline = json.loads(raw)
path = ROOT / "app" / "monthly-mo.json"
monthly = json.loads(path.read_text(encoding="utf-8"))
for metric in ("tvspStationary", "tvspAmbulatory", "tvspDiagnostic"):
    rows = []
    for row in baseline[metric]["rows"]:
        rows.append({
            "name": row["name"], "june": row.get("previous"), "july": row.get("fact"),
            "change": row.get("trend"), "juneQuantity": None,
            "julyQuantity": f'{row["count"]} ТВСП' if isinstance(row.get("count"), (int, float)) else None,
        })
    monthly[metric] = {"unit": "%", "previousLabel": "На 31.07", "currentLabel": "На 31.08", "rows": rows}
path.write_text(json.dumps(monthly, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "sourceCommit": SOURCE_COMMIT, "metrics": 3}, ensure_ascii=False))
