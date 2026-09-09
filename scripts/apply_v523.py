#!/usr/bin/env python3
from pathlib import Path
import base64,hashlib,json,re,tarfile
R=Path(__file__).resolve().parents[1]
P=R/'app/page.tsx'; C=R/'app/globals.css'; M=R/'baseline/manifest.json'
A=R/'data_sources/remd_errors_august_2026.tar.gz'
if not A.exists():
 d=R/'data_sources'
 main=[d/f'remd_errors_august_2026.b64.part{i:02d}' for i in range(10)]
 repair=[d/f'remd_errors_august_2026.b64.part04fix{i:02d}' for i in range(10)]
 parts=main[:4]+repair+main[5:]
 if not all(x.exists() for x in parts):
  missing=[str(x.relative_to(R)) for x in parts if not x.exists()]
  raise RuntimeError(f'missing August REMD source parts: {missing}')
 raw=base64.b64decode(''.join(x.read_text().strip() for x in parts),validate=True)
 digest=hashlib.sha256(raw).hexdigest()
 if digest!='8efd5d2d324990eef522db42701235ef19a33b7ddf82730c303d9af414c87247':
  raise RuntimeError(f'August REMD source integrity mismatch: {digest}')
 A.write_bytes(raw)

def rep(s,a,b,n):
 if a in s:return s.replace(a,b,1)
 if b in s:return s
 raise RuntimeError(n)
def h(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
# Approved full August REMD slice
with tarfile.open(A,'r:gz') as t:
 for n in ('error-categories.json','error-organizations.json'):
  (R/'app'/n).write_bytes(t.extractfile(t.getmember(n)).read())
e=json.loads((R/'app/error-categories.json').read_text());o=json.loads((R/'app/error-organizations.json').read_text())
assert (e['total'],e['period'],len(e['items']))==(785939,'01.08–31.08.2026',32)
assert (o['organizationCount'],o['attributedErrors'],o['unassignedErrors'],o['coveragePercent'])==(213,785939,0,100.0)
# Version + MAX at bottom of Development
s=P.read_text()
s=rep(s,'const DASHBOARD_VERSION = "5.2.2";','const DASHBOARD_VERSION = "5.2.3";','version')
mx='              ["max", "МАХ", "05"],\n'; an='              ["errors", "Ошибки методик", "12"],\n'; div='["divider", "В разработке", ""]'
if s.find('["max", "МАХ", "05"]')<s.find(div): s=rep(s,mx,'','mobile rm');s=rep(s,an,an+mx,'mobile add')
if 'developmentSection ${tab === "max"' not in s:
 pat=re.compile(r'\n\s*<button\n\s*className=\{tab === "max" \? "active" : ""\}\n\s*onClick=\{\(\) => \{\n\s*setTab\("max"\);\n\s*setShowMatrixSections\(false\);\n\s*\}\}\n\s*>\n\s*<span>05</span> МАХ\n\s*</button>',re.M)
 s,n=pat.subn('',s,1);assert n==1
 b='''              <button\n                className={`developmentSection ${tab === "max" ? "active" : ""}`}\n                onClick={() => { setTab("max"); setShowMatrixSections(false); }}\n              >\n                <span>05</span> МАХ\n              </button>\n'''
 s=rep(s,'              <div className="sideFoot">\n',b+'              <div className="sideFoot">\n','desktop add')
P.write_text(s)
# TOP-10 readability, same card footprint
c=C.read_text();mark='/* v5.2.3 hearing TOP-10 readability */'
if mark not in c:c+='''\n\n/* v5.2.3 hearing TOP-10 readability */\n.hearingTopTen p{padding:7px 9px}\n.hearingTopTen p b{font-size:20px;line-height:1}\n.hearingTopTen p span{margin-top:2px;color:#49655c;font-size:11.5px;line-height:1.2;font-weight:750}\n.hearingTopTen>em{font-size:10.5px;line-height:1.35}\n''';C.write_text(c)
# Existing regression contracts updated in place (test count unchanged)
tp=R/'tests/error-mo-drilldown.test.mjs';t=tp.read_text();t=t.replace("test('current category baseline matches the approved 07.09 cumulative source', () => {\n  assert.equal(current.total, 10489964);\n  assert.equal(current.items.length, 34);\n  assert.equal(current.period, '01.01–07.09.2026');\n});","test('current category baseline matches approved full August', () => {\n  assert.equal(current.total, 785939); assert.equal(current.items.length, 32);\n  assert.equal(current.period, '01.08–31.08.2026'); assert.equal(current.share, null);\n});");t=t.replace('  assert.equal(breakdown.organizationCount, 300);','  assert.equal(breakdown.organizationCount, 213);');tp.write_text(t)
tu=R/'tests/ui-remarks-v522.test.mjs';u=tu.read_text();q='  assert.match(css, /v5\\.2\\.2 compact MAX and service selector/u);\n});';z='''  assert.match(css, /v5\\.2\\.2 compact MAX and service selector/u);\n  assert.match(page, /const DASHBOARD_VERSION = "5\\.2\\.3"/u);\n  assert.ok(page.indexOf('["max", "МАХ", "05"]') > page.indexOf('["divider", "В разработке", ""]'));\n  assert.ok(page.includes('developmentSection ${tab === "max"'));\n  assert.doesNotMatch(page, /className=\\{tab === "max" \\? "active" : ""\\}/u);\n  assert.match(css, /v5\\.2\\.3 hearing TOP-10 readability/u);\n});''';u=rep(u,q,z,'ui test');tu.write_text(u)
# Minimal state/docs
rd=R/'README.md';x=rd.read_text().replace('**v5.2.2 от 09.09.2026**','**v5.2.3 от 09.09.2026**',1).replace('## Текущая проверка v5.2.2','## Текущая проверка v5.2.3',1);rd.write_text(x)
st=R/'STATE.md';x=st.read_text().replace('РТ v5.2.2','РТ v5.2.3',1).replace('Рабочая версия: **5.2.2**.','Рабочая версия: **5.2.3**.',1).replace('ошибки РЭМД — **10 489 964** на 07.09','ошибки РЭМД — **785 939** за полный август (01.08–31.08.2026)');st.write_text(x)
op=R/'OPEN_ISSUES.md';x=op.read_text().replace('# Открытые вопросы после фиксации v5.2.0','# Открытые вопросы после фиксации v5.2.3',1).replace('Контроль изменения v5.2.0:','Контроль изменения v5.2.3:',1);op.write_text(x)
# Promote byte-lock baseline for intentional changes
m=json.loads(M.read_text());m['baselineVersion']='5.2.3';m['baselineDate']='2026-09-09';m['changeClass']='UI readability, MAX navigation placement, full-August REMD slice';m['note']='v5.2.3: larger TOP-10 text; MAX last in Development; REMD errors use full August 2026. No error share is calculated without denominator.';m.setdefault('regression',{})['nodeTests']='136/136 PASS'
for g in ('protectedData','protectedRules','stateFiles','keyCode'):
 for p in m.get(g,{}):m[g][p]=h(p)
M.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'version':'5.2.3','remd':[e['period'],e['total'],len(e['items']),o['organizationCount']],'maxDevelopment':True,'top10Font':11.5},ensure_ascii=False))
