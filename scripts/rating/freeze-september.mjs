// One-time, explicit September release. No production build regenerates history.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sourcePath=process.argv[2] || 'app/rating/september-source-components.json';
const raw=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
if(fs.existsSync('app/rating/september-v2-inputs.json')){
 const frozen=JSON.parse(fs.readFileSync('app/rating/september-v2-inputs.json','utf8'));
 for(const [p,hash] of Object.entries(frozen.acceptedDatasetHashes)){
  if(createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==hash)throw Error('Refusing to rewrite September from changed source '+p);
 }
 if(JSON.stringify(raw.sources)!==JSON.stringify(frozen.sources))throw Error('Refusing changed September workbooks');
}

const tmp=path.resolve('.rating-freeze.mjs');
await build({stdin:{contents:fs.readFileSync('app/page.tsx','utf8')+'\nexport {buildOrganizationRating,registryOrganizationByMetricAndName,moRegistry,spasskCrbOrganization,moData,monthlyMoData,indicatorRegistry};',resolveDir:path.resolve('app'),loader:'tsx'},bundle:true,platform:'node',format:'esm',outfile:tmp,external:['react','react-dom']});
const api=await import(pathToFileURL(tmp));
const baseline='a1e175e2de3c0291afa374447c0372478df558f1';
const old=api.buildOrganizationRating();
if (!fs.existsSync('app/rating/september-v1.json')) fs.writeFileSync('app/rating/september-v1.json',JSON.stringify({version:1,month:'2026-09',baselineCommit:baseline,note:'Точная архивная версия: включая оперативный октябрьский 500+ для стоматологий и перераспределение весов отсутствующих блоков.',rows:old},null,2)+'\n');
const physician=JSON.parse(fs.readFileSync('app/physician-metrics.json','utf8'));
const families={semd228:['care','care'],hospital:['care','care'],egpu:['services','services'],egpu2days:['services','services'],doctorsAll:['readiness','activity'],doctorsLevel3:['readiness','activity'],tvspStationary:['readiness','tvsp'],tvspAmbulatory:['readiness','tvsp'],tvspDiagnostic:['readiness','tvsp']};
for(const id of Object.keys(physician.datasets).filter(x=>x.startsWith('doctor500_')))families[id]=['readiness','500'];
const mapped={};const unmapped=[];
for(const [id,rows] of Object.entries(raw.metrics)){
 mapped[id]=new Map();
 for(let r of rows){
  const org=api.registryOrganizationByMetricAndName(id,r.name);
  if(!org){unmapped.push({id,oid:r.oid,name:r.name});continue;}
  if(org.oid==='context:spassk-crb')r={...r,mappingNote:'Контекстное соответствие прежнего справочника: исходная строка РКБ / OID 1094 отображается как Спасская ЦРБ только для отчётов случаев; отдельный OID Спасской ЦРБ не подтверждён.'};
  if(org.oid!==r.oid && org.oid!=='context:spassk-crb')throw Error(`OID mismatch ${id} ${r.oid} ${org.oid}`);
  if(mapped[id].has(org.oid))throw Error('Duplicate mapped OID '+id+' '+org.oid);
  mapped[id].set(org.oid,r);
 }
}
const organizations=[...api.moRegistry.organizations,api.spasskCrbOrganization].filter(o=>o.type!=='Вне рейтинга').map(org=>{
 const metrics=[];
 for(const [id,[block,family]] of Object.entries(families)){
  const pd=physician.datasets[id],pr=pd?.rows.find(r=>r.oid===org.oid);
  const expected=id==='doctorsAll' || (id==='doctorsLevel3'?org.level==='III уровень':id.startsWith('doctor500_')?Boolean(pr && pr.volume>0):org.oid==='context:spassk-crb'?org.applicable.includes(id):org.applicable.includes(id));
  if(!expected)continue;
  let row=mapped[id]?.get(org.oid),n=row?.numerator??null,d=row?.denominator??null;
  if(pd){n=pr?.count??null;d=pr?.volume??null;}
  if(id.startsWith('tvsp')){
   const matches=api.monthlyMoData[id].rows.filter(r=>r.oid===org.oid || (org.oid==='context:spassk-crb' && api.registryOrganizationByMetricAndName(id,r.name)?.oid===org.oid));
   if(matches.length>1)throw Error('Duplicate monthly '+id+org.oid);
   const pair=matches[0]?.julyQuantity?.replace(/\s/g,'').match(/^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
   if(pair){n=Number(pair[1].replace(',','.'));d=Number(pair[2].replace(',','.'));}
  }
  const status=d===0?'not_applicable':n!==null && d!==null && d>0?'available':'missing';
  const period=pd?'01.09–30.09.2026':id.startsWith('egpu')?'01.09–30.09.2026':'01.01–30.09.2026';
  metrics.push({id,name:pd?.name??api.moData[id]?.name??id,block,family,plan:pd?.plan??api.indicatorRegistry.plan(id,api.moData[id]?.plan??null),period,periodKind:pd||id.startsWith('egpu')?'monthly':'cumulative',numerator:n,denominator:d,fact:status==='available'?n/d*100:null,status,reason:status==='missing'?'Нет подтверждённой строки или компонентов сентябрьского расчёта':status==='not_applicable'?'Нулевой знаменатель в исходнике; нет случаев для оценки':null,...(row?.mappingNote?{mappingNote:row.mappingNote}:{}),...(row?.s122!==undefined?{s122:row.s122,s228:row.s228}:{})});
 }
 return {key:org.oid,name:org.shortName,type:org.type,metrics};
});
const hashes={};for(const p of ['app/monthly-mo.json','app/physician-metrics.json','app/mo-registry.json','config/indicator-registry.json'])hashes[p]=createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={version:2,month:'2026-09',label:'Сентябрь 2026',baselineCommit:baseline,sources:raw.sources,acceptedDatasetHashes:hashes,exclusions:[{id:'ambulatoryCase',reason:'Не подтверждена единая пара исходников сентябрьского числителя и знаменателя. Числитель принятого среза отличается от РЭМД на 30.09; смешивание выгрузок исключено.'},{id:'birth/death',reason:'Нет полного подтверждённого сентября; доступный срез относится к августу.'},{id:'tvspLaboratory',reason:'КДЛ исключены из рейтинга; доступны в разделе показателей.'},{id:'operational',reason:'Все октябрьские оперативные срезы, включая 500+ стоматологов, исключены.'}],profileRule:'Специальности 500+ включены только при подтверждённой положительной численности в сентябрьской кадровой выгрузке; отсутствие строки специальности не трактуется как нулевой результат.',unmappedSourceRows:unmapped,organizations};
fs.writeFileSync('app/rating/september-v2-inputs.json',JSON.stringify(result,null,2)+'\n');
fs.unlinkSync(tmp);if(fs.existsSync('.rating-freeze.css'))fs.unlinkSync('.rating-freeze.css');
console.log({organizations:organizations.length,unmapped:unmapped.length,metrics:organizations.reduce((s,r)=>s+r.metrics.length,0)});
