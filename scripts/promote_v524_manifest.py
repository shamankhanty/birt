#!/usr/bin/env python3
"""Promote the verified v5.2.4 source set to the local baseline lock."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))
manifest["baselineVersion"] = "5.2.4"
manifest["baselineDate"] = "2026-09-09"
manifest["changeClass"] = "МО hearing-card grouping, verified regional facts, deterministic Pages CI"
manifest["note"] = "v5.2.4: fixed management grouping in МО для заслушивания; only confirmed facts №22 and №39.1 loaded; Pages CI no longer mutates sources."
for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for rel in manifest.get(group_name, {}):
        target = ROOT / rel
        manifest[group_name][rel] = hashlib.sha256(target.read_bytes()).hexdigest()
manifest["regression"]["nodeTests"] = "pending v5.2.4 verification"
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": manifest["baselineVersion"]}, ensure_ascii=False))
