/** Frozen September policy: no live operational dependencies. */
export function metricScore(metric) {
  if (metric.status !== 'available') return null;
  if (!Number.isFinite(metric.fact) || !(metric.plan > 0) || !(metric.denominator > 0)) throw new Error(`Invalid September components: ${metric.id}`);
  return Math.max(0, Math.min(100, metric.fact / metric.plan * 100));
}
const mean = values => values.reduce((s,v)=>s+v,0) / values.length;

export function calculateSeptemberOrganization(org, policy) {
  const expected = org.metrics.filter(m=>m.status !== 'not_applicable');
  if (new Set(org.metrics.map(m=>m.id)).size !== org.metrics.length) throw new Error('Duplicate metric for '+org.key);
  const blocks = {};
  const weighted = [];
  for (const [block, blockWeight] of Object.entries(policy.weights)) {
    const metrics = expected.filter(m=>m.block===block);
    if (!metrics.length) { blocks[block] = null; continue; }
    const familyResults = [];
    const families = block==='readiness' ? policy.readinessFamilies : {[block]:100};
    for (const [family,weight] of Object.entries(families)) {
      const members = metrics.filter(m=>m.family===family);
      if (!members.length) continue;
      const values=members.map(metricScore);
      familyResults.push({weight,low:mean(values.map(v=>v??0)),high:mean(values.map(v=>v??100))});
    }
    if (!familyResults.length) throw new Error('Unknown rating family');
    const familyWeight=familyResults.reduce((s,v)=>s+v.weight,0);
    const low=familyResults.reduce((s,v)=>s+v.low*v.weight,0)/familyWeight;
    const high=familyResults.reduce((s,v)=>s+v.high*v.weight,0)/familyWeight;
    blocks[block]={low,high,complete:metrics.every(m=>m.status==='available')};
    weighted.push({weight:blockWeight,low,high});
  }
  const totalWeight=weighted.reduce((s,v)=>s+v.weight,0);
  const low=totalWeight?weighted.reduce((s,v)=>s+v.low*v.weight,0)/totalWeight:null;
  const high=totalWeight?weighted.reduce((s,v)=>s+v.high*v.weight,0)/totalWeight:null;
  const available=expected.filter(m=>m.status==='available');
  const complete=expected.length>0 && available.length===expected.length;
  const critical=available.filter(m=>m.block==='care' && metricScore(m)<policy.criticalCareExecution);
  const score=complete?low:null;
  return {...org,score,low,high,blocks,complete,coverage:expected.length?available.length/expected.length*100:0,
    available:available.length,total:expected.length,missing:expected.filter(m=>m.status==='missing'),
    passed:available.filter(m=>m.fact>=m.plan-1e-9).length,critical,
    status:!complete?'Предварительно':score>=policy.leaderScore && !critical.length?'Лидер':critical.length?'Требует внимания':score>=80?'Близко к плану':'Требует внимания'};
}

export function buildSeptemberRating(inputs, legacy, policy) {
  if (inputs.month!==policy.month || legacy.month!==policy.month) throw new Error('Mixed rating months');
  const rows=inputs.organizations.map(org=>calculateSeptemberOrganization(org,policy));
  const types=[...new Set(rows.map(r=>r.type))];
  for(const type of types){
    const previous=legacy.rows.filter(r=>r.type===type && r.score!==null).sort((a,b)=>b.score-a.score||b.coverage-a.coverage||a.name.localeCompare(b.name,'ru'));
    const official=rows.filter(r=>r.type===type && r.complete).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru'));
    official.forEach((r,i)=>{r.place=i>0&&Math.abs(r.score-official[i-1].score)<1e-9?official[i-1].place:i+1;});
    for(const row of rows.filter(r=>r.type===type)){
      const index=previous.findIndex(r=>r.key===row.key),old=index<0?null:previous[index];
      row.oldScore=old?.score??null;row.oldPlace=index<0?null:index+1;
      row.scoreChange=row.score!==null&&row.oldScore!==null?row.score-row.oldScore:null;
      row.reasons=[];
      if(row.missing.length)row.reasons.push('Нет официального места: отсутствуют '+row.missing.length+' обязательных показателей.');
      if(old?.details.some(m=>m.id==='doctor500_dentist' && m.name.includes('оперативный')))row.reasons.push('Октябрьский 500+ заменён полным сентябрём.');
      if(row.metrics.some(m=>m.id==='semd228'))row.reasons.push('Профилактические СЭМД пересчитаны как MAX(122; 228) из РЭМД на 30.09 и знаменателя ФОМС.');
      if(row.metrics.some(m=>m.id==='hospital'))row.reasons.push('Добавлены стационарные эпикризы: числитель и знаменатель из одного отчёта ОМС на 30.09.');
      if(row.metrics.some(m=>m.block==='services'))row.reasons.push('Сентябрьский ЕПГУ включён в блок цифровых услуг (20%).');
      if(old?.details.some(m=>m.id==='ambulatoryCase'))row.reasons.push('Амбулаторные случаи исключены до подтверждения единой пары сентябрьских исходников.');
      row.reasons.push('500+ объединены в одну группу; вес кадровых показателей не зависит от количества специальностей.');
      if(row.critical.length)row.reasons.push('Статус «Лидер» недоступен: выполнение одного из ключевых показателей помощи ниже 80% плана.');
    }
  }
  return rows;
}
