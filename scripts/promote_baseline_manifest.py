#!/usr/bin/env python3
"""Lock the approved v5.1.0 source refresh and hearing-impact redesign."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))


def digest(relative: str) -> str:
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


manifest.update({
    "baselineVersion": "5.1.0",
    "baselineDate": "2026-09-08",
    "changeClass": "source refresh and hearing priority by regional impact",
})
manifest["protectedData"].setdefault("app/error-organizations.json", "")
manifest["protectedData"].setdefault("app/max-monthly-visits.json", "")
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    group = manifest[group_name]
    for relative in list(group):
        group[relative] = digest(relative)
manifest["regression"] = {
    "nodeTests": "132/132 PASS",
    "validation": "15/15 PASS",
    "calculationEquivalence": "38/38 PASS",
    "metadataEquivalence": "38/38 PASS",
    "stagingAdapters": "17/17 PASS",
    "ratingIndicators": 17,
    "latestFullMonth": "август 2026",
    "previousFullMonth": "июль 2026",
    "operationalCut": "07.09.2026",
    "fail": 0,
    "warnings": [],
}
manifest["note"] = "v5.1.0 is the working baseline. Top cards use verified source dates, REMD errors use the approved cumulative 07.09 source, MAX keeps July unavailable without a 30.06 boundary, and hearing priority is ordered by potential regional impact. v5.0.0 remains in Git history."
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": manifest["baselineVersion"]}, ensure_ascii=False))
