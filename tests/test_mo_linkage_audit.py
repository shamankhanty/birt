import unittest

from scripts.audit_mo_linkage import is_valid_no_current_source_row


class MoLinkageAuditTests(unittest.TestCase):
    def test_external_death_without_current_row_is_na(self):
        self.assertTrue(is_valid_no_current_source_row("death", {
            "sourceStatus": "external_source", "fact": None, "count": None,
            "sourceWarning": "нет строки в текущем источнике", "oid": None,
        }))

    def test_canonical_death_without_components_is_not_bypassed(self):
        self.assertFalse(is_valid_no_current_source_row("death", {
            "sourceStatus": None, "fact": None, "count": None,
            "sourceWarning": "нет строки в текущем источнике",
            "oid": "1.2.643.5.1.13.13.12.2.16.1094",
        }))

    def test_external_death_with_current_values_is_checked(self):
        self.assertFalse(is_valid_no_current_source_row("death", {
            "sourceStatus": "external_source", "fact": 100, "count": 44,
            "sourceWarning": "", "oid": None,
        }))

    def test_other_metrics_do_not_get_global_exception(self):
        self.assertFalse(is_valid_no_current_source_row("semd228", {
            "sourceStatus": "external_source", "fact": None, "count": None,
            "sourceWarning": "нет строки", "oid": None,
        }))


if __name__ == "__main__":
    unittest.main()
