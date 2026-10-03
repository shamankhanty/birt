#!/usr/bin/env python3
"""Semantic equivalence gate for a legacy/reference app tree vs staging candidate."""
from __future__ import annotations
import argparse,json,math,re
from pathlib import Path

DEFAULT=[
 'mo-data.json','mo-details.json','mo-detail-oids.json','monthly-mo.json','operational-mo.json',
 'physician-metrics.json','preventive-semd-audit.json','error-categories.json','electronic-waybill-weekly.json'
]

def diff(a,b,path='$',out=None):
 out=[] if out is None else out
 if isinstance(a,(int,float)) and isinstance(b,(int,float)) and not isinstance(a,bool) and not isinstance(b,bool):
  if not math.isclose(float(a),float(b),rel_tol=0,abs_tol=1e-12): out.append({'path':path,'expected':a,'actual':b})
  return out
 if type(a)!=type(b): out.append({'path':path,'expectedType':type(a).__name__,'actualType':type(b).__name__});return out
 if isinstance(a,dict):
  for k in sorted(set(a)|set(b)):
   if k not in a:out.append({'path':f'{path}.{k}','expected':'<missing>','actual':b[k]})
   elif k not in b:out.append({'path':f'{path}.{k}','expected':a[k],'actual':'<missing>'})
   else:diff(a[k],b[k],f'{path}.{k}',out)
 elif isinstance(a,list):
  if len(a)!=len(b):out.append({'path':path+'.length','expected':len(a),'actual':len(b)})
  for i,(x,y) in enumerate(zip(a,b)):diff(x,y,f'{path}[{i}]',out)
 elif a!=b:out.append({'path':path,'expected':a,'actual':b})
 return out

def _type_matches(value, expected_type):
 if expected_type=='number': return isinstance(value,(int,float)) and not isinstance(value,bool)
 if expected_type=='string': return isinstance(value,str)
 if expected_type=='boolean': return isinstance(value,bool)
 if expected_type=='null': return value is None
 return type(value).__name__==expected_type

def _matches_allowance(mismatch, rule):
 if mismatch.get('file')!=rule.get('file'): return False
 try:
  if not re.fullmatch(rule['pathRegex'],mismatch.get('path','')): return False
 except (KeyError,re.error): return False
 if 'expected' in rule and mismatch.get('expected')!=rule['expected']: return False
 if 'actual' in rule and mismatch.get('actual')!=rule['actual']: return False
 if 'actualType' in rule and not _type_matches(mismatch.get('actual'),rule['actualType']): return False
 return True

def run(expected:Path,candidate:Path,files,allowed_differences=None):
 raw=[];checked=[]
 for name in files:
  ep,cp=expected/name,candidate/name
  if not ep.exists() or not cp.exists():
   raw.append({'file':name,'path':'$','expectedExists':ep.exists(),'actualExists':cp.exists()});continue
  e=json.loads(ep.read_text(encoding='utf-8'));c=json.loads(cp.read_text(encoding='utf-8'));ds=diff(e,c)
  checked.append(name)
  for d in ds:raw.append({'file':name,**d})
 rules=allowed_differences or []
 allowed=[];mismatches=[];counts=[0 for _ in rules]
 for mismatch in raw:
  matches=[i for i,rule in enumerate(rules) if _matches_allowance(mismatch,rule)]
  if len(matches)==1:
   counts[matches[0]]+=1;allowed.append(mismatch)
  else:
   # Ambiguous allowances are rejected too: each accepted difference must be
   # covered by exactly one narrow, reviewable rule.
   mismatches.append(mismatch)
 violations=[]
 for index,(rule,count) in enumerate(zip(rules,counts)):
  required=rule.get('count')
  if not isinstance(required,int) or required<1:
   violations.append({'rule':index,'reason':'Allowance must declare a positive exact count','actualCount':count})
  elif count!=required:
   violations.append({'rule':index,'reason':'Allowed difference count does not match','expectedCount':required,'actualCount':count})
 status='PASS' if not mismatches and not violations else 'FAIL'
 return {'schemaVersion':2,'status':status,'checkedFiles':checked,
         'rawMismatchCount':len(raw),'allowedMismatchCount':len(allowed),
         'mismatchCount':len(mismatches),'allowanceViolations':violations,
         'allowedMismatches':allowed[:500],'mismatches':mismatches[:500]}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('expected',type=Path);ap.add_argument('candidate',type=Path);ap.add_argument('--files',nargs='*',default=DEFAULT);ap.add_argument('--report',type=Path);ap.add_argument('--allowances',type=Path)
 a=ap.parse_args();rules=json.loads(a.allowances.read_text(encoding='utf-8')) if a.allowances else None;r=run(a.expected,a.candidate,a.files,rules)
 if a.report:a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(r,ensure_ascii=False,indent=2));raise SystemExit(1 if r['status']=='FAIL' else 0)
if __name__=='__main__':main()
