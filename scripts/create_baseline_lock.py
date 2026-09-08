#!/usr/bin/env python3
"""Create immutable v4.6.0 baseline manifests for refactoring equivalence checks."""
from __future__ import annotations
import hashlib, json, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZIP = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent.parent / "Передача_проекта_дашборд_v4.6.0.zip"
BASE = ROOT / "baseline"
BASE.mkdir(exist_ok=True)


def sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha_file(p: Path) -> str:
    return sha_bytes(p.read_bytes())

# Audit manifest from the untouched handoff ZIP.
with zipfile.ZipFile(ZIP) as zf:
    entries = {}
    for info in sorted(zf.infolist(), key=lambda x: x.filename):
        if info.is_dir():
            continue
        rel = info.filename.split('/', 1)[1] if '/' in info.filename else info.filename
        if not rel:
            continue
        entries[rel] = {"sha256": sha_bytes(zf.read(info)), "bytes": info.file_size}

root_digest = hashlib.sha256()
for rel, meta in sorted(entries.items()):
    root_digest.update(rel.encode())
    root_digest.update(b"\0")
    root_digest.update(meta["sha256"].encode())
    root_digest.update(b"\n")

protected = {
    rel: meta["sha256"]
    for rel, meta in entries.items()
    if rel.startswith("app/") and rel.endswith(".json")
}
protected.update({k: entries[k]["sha256"] for k in ["STATE.md", "OPEN_ISSUES.md"] if k in entries})
manifest = {
    "baselineVersion": "4.6.0",
    "baselineDate": "2026-09-07",
    "baselineCommit": "c50be9e1a04b6aa0641e0dd791c2b9238caa15d1",
    "handoffZipSha256": sha_file(ZIP),
    "sourceTreeSha256": root_digest.hexdigest(),
    "originalFileCount": len(entries),
    "originalFiles": entries,
    "protectedDuringRefactor": protected,
    "note": "originalFiles is audit-only. Tests enforce protectedDuringRefactor; application code may change during later refactoring.",
}
(BASE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

registry = json.loads((ROOT / "config/indicator-registry.json").read_text(encoding="utf-8"))
phys = json.loads((ROOT / "app/physician-metrics.json").read_text(encoding="utf-8"))
mo_registry = json.loads((ROOT / "app/mo-registry.json").read_text(encoding="utf-8"))
prevention = json.loads((ROOT / "app/preventive-semd-audit.json").read_text(encoding="utf-8"))

def dataset_summary(filename: str):
    obj = json.loads((ROOT / filename).read_text(encoding="utf-8"))
    if filename.endswith("physician-metrics.json"):
        obj = obj["datasets"]
    out = {}
    for key, val in obj.items():
        if isinstance(val, dict) and isinstance(val.get("rows"), list):
            out[key] = {
                "rows": len(val["rows"]),
                "plan": val.get("plan"),
                "period": val.get("period"),
                "date": val.get("date"),
                "unit": val.get("unit"),
            }
    return out

semantic = {
    "baselineVersion": "4.6.0",
    "regionalCards": {
        k: {
            "fact": v.get("baselineStaticFact"),
            "plan": v["plan"].get("value"),
            "direction": v.get("direction"),
            "date": v["period"].get("date"),
        }
        for k, v in registry["indicators"].items()
        if v.get("baselineStaticFact") is not None
    },
    "physicianRegional": {
        k: {
            "numerator": v["summary"]["numerator"],
            "denominator": v["summary"]["denominator"],
            "fact": v["summary"]["fact"],
            "plan": v["plan"],
            "period": v.get("period") or phys.get("period"),
        }
        for k, v in phys["datasets"].items()
    },
    "rating": {
        "activeMetricIds": sorted(k for k,v in registry["indicators"].items() if v["rating"]["baselineActive"]),
        "weights": registry["rating"]["blocks"],
        "period": registry["rating"]["baselinePeriod"],
    },
    "datasets": {
        name: dataset_summary(name)
        for name in ["app/mo-data.json", "app/monthly-mo.json", "app/operational-mo.json", "app/organization-status.json", "app/physician-metrics.json"]
    },
    "moRegistry": {
        "organizations": len(mo_registry["organizations"]),
        "unresolved": len(mo_registry.get("unresolved", [])),
        "matchStats": mo_registry.get("matchStats"),
    },
    "preventiveSemd": prevention.get("summary"),
    "expectedLegacyTests": 47,
}
(BASE / "semantic-snapshot.json").write_text(json.dumps(semantic, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print('wrote baseline/manifest.json and baseline/semantic-snapshot.json')
