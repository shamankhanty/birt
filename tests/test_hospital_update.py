import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'pipeline'))
from adapters import adapt_hospital


class HospitalUpdateTests(unittest.TestCase):
    def test_missing_source_row_is_visible_without_a_zero_and_rkb_stays_parent(self):
        oid = '1.2.643.5.1.13.13.12.2.16.1094'
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            (app / 'mo-data.json').write_text(json.dumps({
                'hospital': {
                    'date': '31.10.2026', 'sourceNumerator': 'GIS', 'sourceDenominator': 'GIS',
                    'rows': [
                        {'name': 'РКБ МЗ РТ', 'oid': oid, 'fact': 63.1, 'count': 2275},
                        {'name': 'Другая МО', 'oid': '1.2.3', 'fact': 90, 'count': 9},
                    ],
                },
            }))
            for name in ('mo-details.json', 'mo-detail-oids.json', 'monthly-mo.json'):
                (app / name).write_text('{}')
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = 'v2'
            sheet.cell(6, 2, 'ГАУЗ "РКБ МЗ РТ"')
            sheet.cell(6, 3, oid)
            for column, value in ((4, 3644), (5, 2291), (6, 0)):
                sheet.cell(6, column, value)
            source = app / 'hospital.xlsx'
            workbook.save(source)

            adapt_hospital(app, source, date(2026, 11, 4))
            result = json.loads((app / 'mo-data.json').read_text())['hospital']
            row = next(x for x in result['rows'] if x['oid'] == oid)
            missing = next(x for x in result['rows'] if x['oid'] == '1.2.3')
            self.assertEqual(row['name'], 'ГАУЗ "РКБ МЗ РТ"')
            self.assertAlmostEqual(row['fact'], 2291 / 3644 * 100)
            self.assertEqual((result['numerator'], result['denominator']), (2291, 3644))
            self.assertIsNone(missing['fact'])
            self.assertEqual(missing['sourceStatus'], 'no_source_row')


if __name__ == '__main__':
    unittest.main()
