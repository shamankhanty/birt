import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/pipeline'))
import transactional_stage as tx
from adapters import parse_foms, parse_max, parse_remd, source_rows
from source_catalog import classify, scan
from openpyxl import Workbook
spec=importlib.util.spec_from_file_location('updater',ROOT/'scripts/local_updater_v2.py')
updater=importlib.util.module_from_spec(spec); spec.loader.exec_module(updater)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.inbox=self.root/'inbox'; self.output=self.root/'reports'
        self.inbox.mkdir(); self.output.mkdir(); (self.inbox/'source.xlsx').write_bytes(b'source')

    def test_snapshot_and_duplicate_skip(self):
        result={'state':'PARTIAL','indicators':[],'sourceCount':1}
        with patch.object(tx,'stage',return_value=result) as stage, patch.object(updater.subprocess,'run',return_value=SimpleNamespace(returncode=0)):
            self.assertEqual(updater.process(self.inbox,self.output,0),0)
            self.assertEqual(updater.process(self.inbox,self.output,0),0)
            self.assertEqual(stage.call_count,1)
        summary=json.loads((self.output/'latest.json').read_text(encoding='utf-8'))
        self.assertEqual((Path(summary['run'])/'input/source.xlsx').read_bytes(),b'source')
        self.assertFalse(summary['applied'])

    def test_system_failure_is_stop_and_retried(self):
        with patch.object(tx,'stage',side_effect=RuntimeError('system')) as stage:
            self.assertEqual(updater.process(self.inbox,self.output,0),2)
            self.assertEqual(updater.process(self.inbox,self.output,0),2)
            self.assertEqual(stage.call_count,2)
        self.assertEqual(json.loads((self.output/'latest.json').read_text(encoding='utf8'))['decision'],'STOP')
        self.assertFalse((self.output/'state.json').exists())

    def test_changing_input_not_processed(self):
        with patch.object(updater.time,'sleep',side_effect=lambda _: (self.inbox/'source.xlsx').write_bytes(b'changed')):
            with patch.object(tx,'stage') as stage:
                self.assertEqual(updater.process(self.inbox,self.output,0),3); stage.assert_not_called()

    def test_excel_lock_file_ignored(self):
        (self.inbox/'~$source.xlsx').write_bytes(b'lock')
        self.assertEqual(list(updater.inventory(self.inbox)),['source.xlsx'])

    def test_lock_released(self):
        path=self.output/'lock'
        with updater.Lock(path):
            with self.assertRaises(RuntimeError):
                with updater.Lock(path): pass
        with updater.Lock(path): pass


class WorkbookTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root=Path(self.temp.name)

    def book(self,name,rows):
        book=Workbook(); ws=book.active; ws.title='Лист1'
        for row in rows: ws.append(row)
        path=self.root/name; book.save(path); book.close(); return path

    def test_renamed_max_detects_period_inside_workbook(self):
        p=self.book('renamed.xlsx',[
            ['Посредством национального мессенджера МАХ за период с 01.01.2026 по 17.09.2026'],
            ['Наименование МО',None,None,'Количество проведенных ТМК'],['МО',0,0,5,2]])
        item=classify(p)
        self.assertEqual((item.family,item.startDate,item.endDate),('max_tmk_eln','2026-01-01','2026-09-17'))

    def test_max_control_not_duplicate(self):
        for start in ('01.01.2026','01.09.2026'):
            self.book(start+'.xlsx',[[f'Посредством национального мессенджера МАХ за период с {start} по 17.09.2026'],['Наименование МО'],['МО',0,0,5,2]])
        result=scan(self.root)
        self.assertEqual(result['duplicates'],[]); self.assertEqual(result['summary']['FAIL'],0)

    def test_totals_checked_not_imported(self):
        p=self.book('max.xlsx',[[],[],['МО',0,0,5,2],['Итого',0,0,5,2]])
        self.assertEqual(len(parse_max(p,3)),1)
        p=self.book('bad.xlsx',[[],[],['МО',0,0,5,2],['Итого',0,0,6,2]])
        with self.assertRaisesRegex(ValueError,'Итого'): parse_max(p,3)

    def test_foms_modern_and_legacy_columns(self):
        modern=self.book('modern.xlsx',[[],[],[],['Наименование МО','OID организации','Количество обращений'],['МО','1.2.3',100,80]])
        legacy=self.book('legacy.xlsx',[[],[],[],['№','Наименование МО','OID','Количество обращений'],[1,'МО','1.2.3',100]])
        self.assertEqual(parse_foms(modern),parse_foms(legacy)); self.assertEqual(parse_foms(modern)['1.2.3']['den'],100)

    def test_foms_duplicate_oid_rejected(self):
        p=self.book('duplicate.xlsx',[[],[],[],['МО','OID','Количество'],['МО','1.2.3',100],['МО','1.2.3',100]])
        with self.assertRaisesRegex(ValueError,'повтор'): parse_foms(p)

    def test_combined_remd_renamed(self):
        rows=[[],[],[],[],[1,'МО','1.2.3',0,0,0,0,0,0,80,0,0,0,75]]
        self.assertEqual(parse_remd(self.book('renamed.xlsx',rows))['1.2.3']['s122'],80)

    def test_generation_date_not_reporting_date(self):
        p=self.book('birth_17.09.2026.xlsx',[
            ['Выданные медицинские свидетельства о рождении РТ\n01.01.2026-16.09.2026'],
            ['Дата формирования: 17.09.2026'],['МО','1',None,'Зарегистрирован']])
        self.assertEqual(classify(p).endDate,'2026-09-16')

    def test_oid_aliases_aggregate_without_fuzzy_matching(self):
        org=json.loads((ROOT/'app/mo-registry.json').read_text(encoding='utf8'))['organizations'][0]
        rows=source_rows([{'name':org['aliases'][0],'count':2,'volume':4},{'name':org['aliases'][-1],'count':3,'volume':6}],'birth')
        self.assertEqual(len(rows),1); self.assertEqual((rows[0]['count'],rows[0]['volume'],rows[0]['fact']),(5,10,50))


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.app=self.root/'app'; self.app.mkdir()
        for name in tx.MAPS: tx.write(self.app/name,{})
        self.original={'egpu':{'date':'11.09.2026','period':'old','rows':[{'name':'old','fact':90}]},'egpu2days':{'date':'11.09.2026','period':'old','rows':[{'name':'old','fact':70}]}}
        tx.write(self.app/'mo-data.json',self.original)
        self.item={'family':'egpu_attachment','name':'source.xlsx','path':'source.xlsx','status':'PASS','endDate':'2026-09-17','startDate':'2026-01-01'}
        patches=[patch.object(tx,'ROOT',self.root),patch.object(tx,'METRICS',{'egpu_attachment':['egpu','egpu2days']}),patch.object(tx,'scan',return_value={'files':[self.item]}),patch.object(tx,'validate',side_effect=self.validate),patch.object(tx.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='',stderr=''))]
        for p in patches: p.start(); self.addCleanup(p.stop)

    def validate(self,app,out):
        out.mkdir(parents=True,exist_ok=True)
        return {'overallStatus':'PASS','summary':{},'checks':[]}

    def invoke(self,app,family,metric,item,partner):
        data=tx.read(app/'mo-data.json'); data[metric]={'date':'17.09.2026','period':'new','rows':[]}; tx.write(app/'mo-data.json',data)
        if metric=='egpu': raise ValueError('bad numerator AFTER write')
        return SimpleNamespace(status='PASS',errors=[],warnings=[],facts={})

    def test_failed_indicator_keeps_data_and_period_sibling_commits(self):
        with patch.object(tx,'invoke',side_effect=self.invoke): result=tx.stage(self.root/'inbox',self.root/'candidate')
        candidate=tx.read(self.root/'candidate/app/mo-data.json')
        self.assertEqual(candidate['egpu'],self.original['egpu']); self.assertEqual(candidate['egpu2days']['date'],'17.09.2026')
        self.assertEqual(tx.read(self.app/'mo-data.json'),self.original); self.assertEqual(result['state'],'PARTIAL')
        self.assertEqual([i['state'] for i in result['indicators']],['RETAINED','PREPARED'])

    def test_validation_failure_rolls_back(self):
        def validation(app,out):
            if 'egpu2days' in str(out): return {'overallStatus':'FAIL','checks':[{'id':'bad','status':'FAIL','issues':[{'status':'FAIL','kind':'invalid'}]}]}
            return self.validate(app,out)
        with patch.object(tx,'invoke',side_effect=self.invoke),patch.object(tx,'validate',side_effect=validation): result=tx.stage(self.root/'inbox',self.root/'candidate')
        self.assertEqual(tx.read(self.root/'candidate/app/mo-data.json'),self.original)
        self.assertTrue(all(i['state']=='RETAINED' for i in result['indicators']))

    def test_missing_history_not_fabricated_pass(self):
        self.assertEqual(tx.historical_replay(self.root/'replay')['status'],'UNAVAILABLE')

    def test_statistics_separate_missing_invalid_and_unchanged(self):
        rows=[{'state':'PREPARED','sources':['ok.xlsx']},
              {'state':'UNCHANGED','sources':['same.xlsx']},
              {'state':'RETAINED','sources':['bad.xlsx']},
              {'state':'RETAINED','sources':[]}]
        self.assertEqual(tx.indicator_statistics(rows),{
            'expectedIndicators':4,'receivedIndicators':3,'preparedIndicators':1,
            'unchangedIndicators':1,'retainedInvalidIndicators':1,'missingSourceIndicators':1})

    def test_control_only_max_is_received_but_not_prepared(self):
        item={**self.item,'family':'max_tmk_eln','startDate':'2026-09-01'}
        with patch.object(tx,'METRICS',{'max_tmk_eln':['tmkMaxCount']}),patch.object(tx,'scan',return_value={'files':[item]}):
            result=tx.stage(self.root/'inbox',self.root/'candidate')
        self.assertEqual(result['statistics']['receivedIndicators'],1)
        self.assertEqual(result['statistics']['retainedInvalidIndicators'],1)
        self.assertEqual(result['statistics']['missingSourceIndicators'],0)

    def test_ready_requires_actual_history_coverage(self):
        with patch.object(tx,'METRICS',{'egpu_attachment':['egpu2days']}),patch.object(tx,'invoke',side_effect=self.invoke),patch.object(tx,'historical_replay',return_value={'status':'PASS','cases':[{'metric':'egpu2days','status':'PASS'}]}):
            self.assertEqual(tx.stage(self.root/'inbox',self.root/'candidate')['state'],'READY')

    def test_repeat_drift_rejects_indicator(self):
        with patch.object(tx,'invoke',side_effect=self.invoke),patch.object(tx,'compare_trees',return_value={'status':'FAIL'}):
            result=tx.stage(self.root/'inbox',self.root/'candidate')
        self.assertTrue(all(i['state']=='RETAINED' for i in result['indicators']))
        self.assertEqual(tx.read(self.root/'candidate/app/mo-data.json'),self.original)

    def test_systemic_validator_error_propagates(self):
        with patch.object(tx,'validate',side_effect=tx.SystemicError('validator unavailable')):
            with self.assertRaises(tx.SystemicError): tx.stage(self.root/'inbox',self.root/'candidate')

    def test_older_source_not_promoted(self):
        self.item['endDate']='2026-09-01'
        with patch.object(tx,'invoke') as invoke:
            result=tx.stage(self.root/'inbox',self.root/'candidate'); invoke.assert_not_called()
        self.assertTrue(all(i['state']=='RETAINED' for i in result['indicators']))

    def test_historical_replay_executes_and_detects_mismatch(self):
        import hashlib
        source=self.root/'history.xlsx'; source.write_bytes(b'fixture')
        expected=self.root/'expected'; expected.mkdir()
        anticipated=dict(self.original); anticipated['egpu2days']={'date':'17.09.2026','period':'new','rows':[]}
        tx.write(expected/'mo-data.json',anticipated)
        manifest=self.root/'history.json'
        tx.write(manifest,{'cases':[{'metric':'egpu2days','baselineApp':str(self.app),'expectedApp':str(expected),
                                  'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                                  'source':{**self.item,'path':str(source)},'files':['mo-data.json']}]})
        with patch.object(tx,'invoke',side_effect=self.invoke):
            self.assertEqual(tx.historical_replay(self.root/'replay',manifest)['status'],'PASS')
        with patch.object(tx,'invoke') as invoke:
            cached=tx.historical_replay(self.root/'cached',manifest)
            self.assertTrue(cached['reusedQualification']); invoke.assert_not_called()
        with patch.object(tx,'invoke',side_effect=self.invoke) as invoke:
            tx.write(expected/'mo-data.json',self.original)
            self.assertEqual(tx.historical_replay(self.root/'replay2',manifest)['status'],'FAIL')
            invoke.assert_called_once()


if __name__=='__main__': unittest.main()
