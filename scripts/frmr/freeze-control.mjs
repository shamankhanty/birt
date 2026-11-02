// Run before importing the next workbook: node scripts/frmr/freeze-control.mjs DD.MM.YYYY
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {applyFrmrScope} from '../../lib/frmr-scope.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const raw=read('app/frmr-all-specialties.json'),types=read('app/frmr-sp-types.json');
const date=s=>{if(!/^\d{2}\.\d{2}\.\d{4}$/.test(s??''))throw Error('Expected next cut DD.MM.YYYY');const [d,m,y]=s.split('.');return `${y}-${m}-${d}`;};
if(date(process.argv[2])<=date(raw.summary.sourceCut))throw Error('Next cut must be later; do not overwrite the comparison with the current cut');
if(raw.metadata.source.sha256!==types.source.sha256)throw Error('SP types belong to a different source');
const {data,excluded}=applyFrmrScope(raw,types.types);const groups=new Map();
for(const [mo,role,sp,,issue] of data.records.rows){const dep=data.departments.sp[sp];const oid='1.2.643.5.1.13.13.12.2.16.'+data.departments.mos[mo]+'.0.'+dep[1];const key=JSON.stringify([data.departments.mos[mo],data.departments.roles[role],types.types[oid]??'Не указан',issue]);groups.set(key,(groups.get(key)??0)+1);}
const result={cut:raw.summary.sourceCut,source:raw.metadata.source,organizations:data.departments.mos,excluded,rows:[...groups].map(([k,n])=>[...JSON.parse(k),n])};
const target=path.join(root,'app/frmr-previous-control.json');fs.writeFileSync(target+'.tmp',JSON.stringify(result)+'\n');fs.renameSync(target+'.tmp',target);
console.log({previousCut:result.cut,total:data.records.rows.length,groups:result.rows.length});
