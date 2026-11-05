import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pipeline.excel_structure import inspect_workbook
from pipeline.adapters import parse_ambulatory_cases


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


if __name__ == '__main__':
    unittest.main()
