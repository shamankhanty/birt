/** MAX plans are cumulative organization control points, not a generic regional target. */
export function maxHearingPlan(targets, id, oid, date, period) {
  const service = id === 'tmkMaxCount' ? 'tmk' : id === 'elnMaxCount' ? 'eln' : null;
  if (!service) return null;
  const target = targets.organizationPlans[oid];
  if (!target) return {assigned:false, plan:null, label:'МО отсутствует в утверждённом перечне планов МАХ'};
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date ?? '');
  if (!match) return {assigned:true,plan:null,label:'Дата факта не определена — контрольная точка не выбрана'};
  const [,day,month,year]=match;
  const parsed = new Date(Date.UTC(+year,+month-1,+day));
  if (parsed.getUTCDate()!==+day || parsed.getUTCMonth()!==+month-1) return {assigned:true,plan:null,label:'Некорректная дата факта — контрольная точка не выбрана'};
  const start=/^01\.01(?:\.(\d{4}))?\s*[–—-]\s*/.exec(period ?? '');
  if (!start || (start[1] && start[1]!==year) || !period.endsWith(date)) return {assigned:true,plan:null,label:'Накопительный план МО несопоставим с периодом этого факта'};
  const value=target[service]?.[`${year}-${month}`];
  if (typeof value!=='number' || !Number.isFinite(value) || value<0) return {assigned:true,plan:null,label:'Для месяца факта нет утверждённой контрольной точки МО'};
  const end=new Date(Date.UTC(+year,+month,0)).getUTCDate();
  return {assigned:true,plan:value,label:`План МО на ${end}.${month}.${year} · накопительным итогом`};
}
