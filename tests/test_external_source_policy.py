import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from adapters import is_external_source_name, monthly_payload


class ExternalSourcePolicyTests(unittest.TestCase):
    def test_private_and_out_of_region_providers_stay_visible_but_external(self):
        for name in (
            'ООО "Красноключинский центр семейной медицины"',
            'ООО "ММЦ Профмедицина-НК"',
            'ЧУЗ "Больница "РЖД-Медицина" города Ижевск"',
            'ЧУЗ "КБ "РЖД-Медицина" г. Казани"',
        ):
            self.assertTrue(is_external_source_name(name))

    def test_monthly_payload_preserves_external_status_with_a_valid_source_oid(self):
        rows = monthly_payload({}, [{
            "name": 'ЧУЗ "КБ "РЖД-Медицина" г. Казани"',
            "oid": "1.2.643.5.1.13.13.12.2.16.1197",
            "fact": 75.0,
            "count": 3,
            "volume": 4,
            "sourceStatus": "external_source",
        }], date(2026, 9, 30))
        self.assertEqual(rows["rows"][0]["sourceStatus"], "external_source")
        self.assertEqual(rows["rows"][0]["oid"], "1.2.643.5.1.13.13.12.2.16.1197")

