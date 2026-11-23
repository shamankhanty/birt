"""Maintain comparable EPGU per-organization denominators in staging only.

The saved current cut is the previous cut of the next validated cumulative
source. A mismatch leaves the historical file unchanged so that the UI
displays 'no comparable data', never a misleading zero.
"""
from __future__ import annotations

import json
from pathlib import Path


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def refresh_attachment_volume_snapshots(base: Path, generated: Path, metric: str) -> bool:
    if metric not in ("egpu", "egpu2days"):
        return False
    filename = "egpu-attachment-volume-snapshots.json"
    target = generated / filename
    source = base / filename
    if not source.exists() or not target.exists():
        return False

    snapshot = read(source)
    old_mo = read(base / "mo-data.json").get(metric, {})
    new_mo = read(generated / "mo-data.json").get(metric, {})
    old_current = snapshot.get("current", {})
    if not new_mo.get("date") or new_mo["date"] == old_mo.get("date"):
        return False
    # A snapshot from another period or a changed starting scope cannot
    # be used to infer the previous number of submitted applications.
    if (old_current.get("date") != old_mo.get("date") or
            old_current.get("total") != old_mo.get("denominator") or
            new_mo.get("previousDate") != old_mo.get("date") or
            new_mo.get("previousDenominator") != old_mo.get("denominator") or
            new_mo.get("previousPeriod") != old_mo.get("period")):
        return False

    oid_details = read(generated / "mo-detail-oids.json").get(metric, {})
    volumes = {oid: item["volume"] for oid, item in oid_details.items()
               if isinstance(item, dict) and isinstance(item.get("volume"), int)
               and not isinstance(item.get("volume"), bool) and item["volume"] >= 0}
    if (len(volumes) != len(oid_details) or
            sum(volumes.values()) != new_mo.get("denominator") or
            not volumes):
        return False

    # The report is cumulative from the beginning of the same year;
    # different starting dates and mixed perimeters must not be compared.
    old_period = old_mo.get("period", "")
    new_period = new_mo.get("period", "")
    if not (old_period and new_period and "–" in old_period and "–" in new_period
            and old_period.split("–")[0] == new_period.split("–")[0]):
        return False
    old_oids = old_current.get("byOid", {})
    if set(old_oids) != set(volumes) or sum(old_oids.values()) != old_current["total"]:
        return False

    next_snapshot = {
        **snapshot,
        "previous": old_current,
        "current": {
            "date": new_mo["date"],
            "period": new_period,
            "total": new_mo["denominator"],
            "sourceCommit": None,
            "byOid": dict(sorted(volumes.items())),
        }
    }
    target.write_text(json.dumps(next_snapshot, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    return True
