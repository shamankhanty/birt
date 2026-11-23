import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))
from egpu_movement import refresh_attachment_volume_snapshots


class EgpuMovementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.base, self.staged = root / "base", root / "staged"
        self.base.mkdir()
        self.staged.mkdir()
        snapshot = {
            "schemaVersion": 1,
            "previous": {"date": "12.11.2026", "period": "01.01–12.11.2026",
                         "total": 27, "byOid": {"a": 11, "b": 16}},
            "current": {"date": "19.11.2026", "period": "01.01–19.11.2026",
                        "total": 30, "byOid": {"a": 12, "b": 18}},
        }
        self.write(self.base, "egpu-attachment-volume-snapshots.json", snapshot)
        self.write(self.staged, "egpu-attachment-volume-snapshots.json", snapshot)
        self.write(self.base, "mo-data.json", {"egpu": {"date": "19.11.2026", "period": "01.01–19.11.2026",
                                                       "denominator": 30}})
        self.write(self.staged, "mo-data.json", {"egpu": {"date": "26.11.2026", "period": "01.01–26.11.2026",
                                                          "previousDate": "19.11.2026", "previousPeriod": "01.01–19.11.2026",
                                                          "previousDenominator": 30, "denominator": 34}})
        self.write(self.staged, "mo-detail-oids.json", {"egpu": {"a": {"volume": 14}, "b": {"volume": 20}}})

    def write(self, root, name, data):
        (root / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def read(self, root, name):
        return json.loads((root / name).read_text(encoding="utf-8"))

    def test_promotes_previous_source_and_current_volumes_without_editing_base(self):
        self.assertTrue(refresh_attachment_volume_snapshots(self.base, self.staged, "egpu"))
        old = self.read(self.base, "egpu-attachment-volume-snapshots.json")
        new = self.read(self.staged, "egpu-attachment-volume-snapshots.json")
        self.assertEqual(new["previous"], old["current"])
        self.assertEqual(new["current"]["byOid"], {"a": 14, "b": 20})
        self.assertEqual(new["current"]["total"] - new["previous"]["total"], 4)
        self.assertIsNone(new["current"]["sourceCommit"])
        self.assertFalse(refresh_attachment_volume_snapshots(self.base, self.staged, "egpu2days"))

    def test_source_mismatch_does_not_change_saved_snapshot(self):
        before = self.read(self.staged, "egpu-attachment-volume-snapshots.json")
        for bad in [
            {"previousDate": "12.11.2026"},
            {"previousDenominator": 29},
            {"previousPeriod": "01.01–12.11.2026"},
            {"denominator": 35},
            {"period": "01.11–26.11.2026"},
        ]:
            data = self.read(self.staged, "mo-data.json")
            data["egpu"].update({"date": "26.11.2026", "period": "01.01–26.11.2026",
                                 "previousDate": "19.11.2026", "previousPeriod": "01.01–19.11.2026",
                                 "previousDenominator": 30, "denominator": 34})
            data["egpu"].update(bad)
            self.write(self.staged, "mo-data.json", data)
            self.assertFalse(refresh_attachment_volume_snapshots(self.base, self.staged, "egpu"))
            self.assertEqual(self.read(self.staged, "egpu-attachment-volume-snapshots.json"), before)


if __name__ == "__main__":
    unittest.main()
