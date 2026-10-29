import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from openpyxl import Workbook

spec = importlib.util.spec_from_file_location('audit', Path(__file__).resolve().parents[1] / 'scripts/audit_weekly_source_coverage.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class CoverageTests(unittest.TestCase):
    def run_case(self, mismatch=False, zipped=False):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); local=root/'input'; local.mkdir()
            workbook=root/'sample.xlsx'; book=Workbook(); sheet=book.active
            sheet.append(['OID','Count']); sheet.append(['1.2.3',7]); book.create_sheet('Unused sheet').append(['extra'])
            book.save(workbook)
            evidence=root/'evidence.json'; evidence.write_text(json.dumps({'sourceFiles': {'sample.xlsx': 'invalid' if mismatch else hashlib.sha256(workbook.read_bytes()).hexdigest()}}))
            if zipped:
                with zipfile.ZipFile(local/'package.zip','w') as archive: archive.write(workbook,'nested/garbled-legacy-name.xlsx')
            else: (local/'sample.xlsx').write_bytes(workbook.read_bytes())
            args=argparse.Namespace(evidence=str(evidence),output=root/'report',local=local,remote=[],replay=False)
            audit.run(args)
            return json.loads((root/'report/source-coverage.json').read_text())
    def test_hash_match_inventories_every_sheet_without_claiming_complete_parser_coverage(self):
        report=self.run_case()
        self.assertEqual(report['matchedFiles'],1)
        self.assertEqual(len(report['sources'][0]['sheets']),2)
        self.assertEqual(report['sources'][0]['sheets'][0]['nonEmptyRows'],2)
        self.assertEqual(report['fullWorkbookCoverage'],'NOT_ESTABLISHED')
    def test_same_filename_with_different_hash_is_not_accepted(self):
        report=self.run_case(mismatch=True)
        self.assertEqual(report['matchedFiles'],0)
        self.assertEqual(report['sources'][0]['status'],'MISSING')
    def test_zip_member_resolves_by_hash_even_if_legacy_filename_is_garbled(self):
        self.assertEqual(self.run_case(zipped=True)['matchedFiles'],1)

if __name__ == '__main__': unittest.main()
