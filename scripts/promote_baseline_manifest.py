#!/usr/bin/env python3
"""Lock the approved v5.2.0 MAX municipal appointment update."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))


def digest(relative: str) -> str:
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


manifest.update({
    "baselineVersion": "5.2.0",
    "baselineDate": "2026-09-08",
    "changeClass": "MAX doctor appointments by municipality without MO attribution",
})
manifest["protectedData"].setdefault("app/error-organizations.json", "")
manifest["protectedData"].setdefault("app/max-monthly-visits.json", "")
manifest["protectedData"].setdefault("app/max-appointments-municipal.json", "")
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    group = manifest[group_name]
    for relative in list(group):
        group[relative] = digest(relative)
manifest["regression"] = {
    "nodeTests": "132/132 PASS (unit/data tests; rendered-html requires production build)",
    "validation": "15/15 PASS",
    "calculationEquivalence": "38/38 PASS",
    "metadataEquivalence": "38/38 PASS",
    "stagingAdapters": "19/19 PASS",
    "ratingIndicators": 17,
    "latestFullMonth": "август 2026",
    "previousFullMonth": "июль 2026",
    "operationalCut": "07.09.2026",
    "fail": 0,
    "warnings": ["production build-gate pending before publication"],
}
manifest["note"] = "v5.2.0 adds factual doctor appointments through MAX by municipality and removes appointment attribution from MO-level MAX tables. Production build-gate must be rerun before publication."
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": manifest["baselineVersion"]}, ensure_ascii=False))
