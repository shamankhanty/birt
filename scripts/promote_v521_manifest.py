#!/usr/bin/env python3
"""Lock the approved v5.2.1 navigation and GitHub Pages release."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))


def digest(relative: str) -> str:
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


manifest["baselineVersion"] = "5.2.1"
manifest["baselineDate"] = "2026-09-09"
manifest["changeClass"] = "navigation labels and GitHub Pages release pipeline"
manifest["note"] = (
    "v5.2.1 reorganizes navigation and abbreviates MСР/MСС labels without changing "
    "approved calculations. GitHub Pages is the sole publication channel."
)

for group_name in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
    for relative in list(manifest.get(group_name, {})):
        manifest[group_name][relative] = digest(relative)

manifest_path.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps({"status": "PASS", "baselineVersion": "5.2.1"}, ensure_ascii=False))
