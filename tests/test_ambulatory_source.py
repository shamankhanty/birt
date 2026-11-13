import sys
import tempfile
import unittest
from pathlib import Path
from datetime import date

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pipeline.excel_structure import inspect_workbook
from pipeline.adapters import parse_ambulatory_cases, adapt_ambulatory_cases


class AmbulatorySourceTests(unittest.TestCase):
    def test_cumulative_summary_and_monthly_sheets_have_distinct_valid_periods(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'amb.xlsx'
            book = Workbook()
            summary = book.active
            summary.title = 'Свод'
            monthly = book.create_sheet('01.01-31.01.')
            for sheet, period in ((summary, '01.01.2026 по 03.11.2026'),
                                  (monthly, '01.01.2026 по 31.01.2026')):
                sheet.cell(2, 1, f'Отчет по Эпикриз по законченному случаю амбулаторный за период с {period}')
                sheet.cell(3, 2, 'OID')
                sheet.cell(5, 1, 'МО')
                sheet.cell(5, 2, '1.2.3')
                sheet.cell(5, 3, 100)
            summary.cell(5, 4, None)
            monthly.cell(5, 4, 20)
            book.save(path)

            inspection = inspect_workbook(path)
            self.assertEqual(inspection['family'], 'ambulatory_cases')
            self.assertEqual(inspection['endDate'], '2026-11-03')
            self.assertNotIn('error', inspection)
            with self.assertRaisesRegex(ValueError, 'пустой числитель у 1 строк при 100 случаях'):
                parse_ambulatory_cases(path)

            summary.cell(5, 4, 80)
            book.save(path)
            self.assertEqual(parse_ambulatory_cases(path)[0]['count'], 80)


    def test_two_private_source_rows_with_shared_oid_preserve_totals_and_details(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            oid = "1.2.643.9.11"
            old_rows = [
                {"name": "ООО Прозрение, филиал А", "oid": oid, "fact": 80},
                {"name": "ООО Прозрение, филиал Б", "oid": oid, "fact": 90},
            ]
            (path / "mo-data.json").write_text(
                __import__("json").dumps({"ambulatoryCase": {"date": "27.10.2026", "rows": old_rows}}),
                encoding="utf-8")
            for name in ("mo-details.json", "mo-detail-oids.json", "monthly-mo.json"):
                (path / name).write_text("{}", encoding="utf-8")
            wb = Workbook()
            ws = wb.active
            for row, name, den, num in ((5, "ООО Прозрение, филиал А", 100, 80),
                                        (6, "ООО Прозрение, филиал Б", 50, 45)):
                ws.cell(row, 1, name)
                ws.cell(row, 2, oid)
                ws.cell(row, 3, den)
                ws.cell(row, 4, num)
            source = path / "ambulatory.xlsx"
            wb.save(source)
            result = adapt_ambulatory_cases(path, source, date(2026, 11, 7))
            import json
            dataset = json.loads((path / "mo-data.json").read_text())["ambulatoryCase"]
            detail = json.loads((path / "mo-detail-oids.json").read_text())["ambulatoryCase"][oid]
            self.assertEqual((dataset["numerator"], dataset["denominator"]), (125, 150))
            self.assertAlmostEqual(dataset["fact"], 125 / 150 * 100)
            self.assertIn("07.11.2026", dataset["source"])
            self.assertEqual((result.facts["sourceRows"], result.facts["mergedOids"]), (2, 1))
            self.assertEqual(len(dataset["rows"]), 1)
            item = dataset["rows"][0]
            self.assertEqual(item["sourceRows"], 2)
            self.assertEqual(item["sourceStatus"], "external_source")
            self.assertAlmostEqual(item["fact"], 125 / 150 * 100)
            self.assertIsNone(item["previous"])
            self.assertIsNone(item["trend"])
            self.assertEqual((detail["registered"], detail["volume"]), (125, 150))

    def test_missing_previous_fact_does_not_raise_or_become_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            oid = "1.2.643.9.12"
            (path / "mo-data.json").write_text(
                __import__("json").dumps({"ambulatoryCase": {
                    "date": "27.10.2026", "rows": [
                        {"name": "ГАУЗ Тест", "oid": oid, "fact": None}]}}),
                encoding="utf-8")
            for name in ("mo-details.json", "mo-detail-oids.json", "monthly-mo.json"):
                (path / name).write_text("{}", encoding="utf-8")
            wb = Workbook()
            ws = wb.active
            for col, value in enumerate(("ГАУЗ Тест", oid, 100, 92), 1):
                ws.cell(5, col, value)
            source = path / "ambulatory.xlsx"
            wb.save(source)
            adapt_ambulatory_cases(path, source, date(2026, 11, 7))
            import json
            row = json.loads((path / "mo-data.json").read_text())["ambulatoryCase"]["rows"][0]
            self.assertEqual(row["fact"], 92)
            self.assertIsNone(row["previous"])
            self.assertIsNone(row["trend"])


if __name__ == '__main__':
    unittest.main()
