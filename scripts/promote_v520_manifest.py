#!/usr/bin/env python3
"""Refresh v5.2.0 baseline hashes after generating the MAX municipality section."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))


def digest(relative: str) -> str:
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


manifest["baselineVersion"] = "5.2.0"
manifest["baselineDate"] = "2026-09-09"
manifest["changeClass"] = "MAX doctor appointments by municipality without MO attribution"
manifest.setdefault("protectedData", {})["app/max-appointments-municipal.json"] = ""

for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for relative in list(manifest.get(group_name, {})):
        manifest[group_name][relative] = digest(relative)

manifest_path.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps({"status": "PASS", "baselineVersion": "5.2.0"}, ensure_ascii=False))
