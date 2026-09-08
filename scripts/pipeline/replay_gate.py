#!/usr/bin/env python3
"""Semantic equivalence gate for a legacy/reference app tree vs staging candidate."""
from __future__ import annotations
import argparse,json,math
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

def run(expected:Path,candidate:Path,files):
 mismatches=[];checked=[]
 for name in files:
  ep,cp=expected/name,candidate/name
  if not ep.exists() or not cp.exists():
   mismatches.append({'file':name,'path':'$','expectedExists':ep.exists(),'actualExists':cp.exists()});continue
  e=json.loads(ep.read_text(encoding='utf-8'));c=json.loads(cp.read_text(encoding='utf-8'));ds=diff(e,c)
  checked.append(name)
  for d in ds[:500]:mismatches.append({'file':name,**d})
 return {'schemaVersion':1,'status':'PASS' if not mismatches else 'FAIL','checkedFiles':checked,'mismatchCount':len(mismatches),'mismatches':mismatches[:500]}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('expected',type=Path);ap.add_argument('candidate',type=Path);ap.add_argument('--files',nargs='*',default=DEFAULT);ap.add_argument('--report',type=Path)
 a=ap.parse_args();r=run(a.expected,a.candidate,a.files)
 if a.report:a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(r,ensure_ascii=False,indent=2));raise SystemExit(1 if r['status']=='FAIL' else 0)
if __name__=='__main__':main()
