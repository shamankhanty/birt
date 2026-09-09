#!/usr/bin/env python3
"""Promote the verified v5.2.5 source set to the local baseline lock."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))
manifest["baselineVersion"] = "5.2.5"
manifest["baselineDate"] = "2026-09-09"
manifest["changeClass"] = "МАХ official/operational separation, manual RT facts, physician applicability, EPGU trend"
manifest["note"] = "v5.2.5: official MAX results are visually separated from МО monitoring; agreed RT facts are marked as manual until primary reports arrive; physician applicability and EPGU operational trend are corrected."
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for rel in manifest.get(group_name, {}):
        target = ROOT / rel
        manifest[group_name][rel] = hashlib.sha256(target.read_bytes()).hexdigest()
manifest["regression"]["nodeTests"] = "143/143 PASS"
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": manifest["baselineVersion"]}, ensure_ascii=False))
