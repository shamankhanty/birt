#!/usr/bin/env python3
"""Promote approved UI facts and preventive audit into the semantic baseline."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "baseline" / "semantic-snapshot.json"
snapshot = json.loads(path.read_text(encoding="utf-8"))
page = (ROOT / "app" / "page.tsx").read_text(encoding="utf-8")
block = page.split("const baselineIndicators: Indicator[] = [", 1)[1].split("];", 1)[0]
for match in re.finditer(r'\{\s*id:\s*"([^"]+)"(?P<body>.*?)\n\s*\}', block, re.S):
    indicator_id, body = match.group(1), match.group("body")
    if indicator_id not in snapshot["regionalCards"]:
        continue
    fact = re.search(r'\bfact:\s*(-?[\d.]+)', body)
    date = re.search(r'\bdate:\s*"([^"]+)"', body)
    if fact:
        snapshot["regionalCards"][indicator_id]["fact"] = float(fact.group(1))
    if date:
        snapshot["regionalCards"][indicator_id]["date"] = date.group(1)
snapshot["regionalCards"]["errors"]["plan"] = None
snapshot["preventiveSemd"] = json.loads((ROOT / "app" / "preventive-semd-audit.json").read_text(encoding="utf-8"))["summary"]
snapshot["baselineVersion"] = "4.7.0"
path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "PASS", "baselineVersion": snapshot["baselineVersion"]}, ensure_ascii=False))
