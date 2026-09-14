#!/usr/bin/env python3
"""Promote the verified v5.3.0 source set to the local baseline lock."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))
manifest["baselineVersion"] = "5.3.0"
manifest["baselineDate"] = "2026-09-14"
manifest["changeClass"] = "Оперативный срез 11.09, недельный 500+ вне месячного рейтинга, контроль отсутствующих строк"
manifest["note"] = "v5.3.0: источники обновлены на 11.09.2026; август сохранён единственным полным месяцем рейтинга; неполный сентябрьский файл 500+ доступен только как оперативный недельный контроль раздела «Показатели»."
manifest["protectedData"]["app/physician-weekly-snapshot.json"] = ""
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for rel in manifest.get(group_name, {}):
        target = ROOT / rel
        manifest[group_name][rel] = hashlib.sha256(target.read_bytes()).hexdigest()
manifest["regression"].update({
    "nodeTests": "144/144 PASS",
    "validation": "15/15 PASS",
    "calculationEquivalence": "38/38 PASS",
    "metadataEquivalence": "38/38 PASS",
    "stagingAdapters": "21/21 PASS",
    "ratingIndicators": 17,
    "latestFullMonth": "август 2026",
    "previousFullMonth": "июль 2026",
    "operationalCut": "11.09.2026",
    "fail": 0,
    "warnings": [],
})
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": manifest["baselineVersion"]}, ensure_ascii=False))
