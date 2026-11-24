/** Conservative name + locality matching. Source names and counts remain unchanged.
 * A name match is a diagnostic association, never a verified OID crosswalk.
 */
const normalize = value => String(value ?? "").toUpperCase().replace(/Ё/g,"Е").replace(/[«»"]/g,"").replace(/\s+/g," ").trim();
const locality = value => normalize(value).replace(/КАЗАНИ/g,"КАЗАНЬ").replace(/НАБЕРЕЖНЫХ ЧЕЛНАХ|НАБЕРЕЖНЫЕ ЧЕЛНЫ|Н\.?\s*ЧЕЛНЫ/g,"НАБЕРЕЖНЫЕ ЧЕЛНЫ");
export function comparableName(value) {
  return normalize(value)
    .replace(/^(?:ГОСУДАРСТВЕННОЕ\s+АВТОНОМНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГОСУДАРСТВЕННОЕ\s+БЮДЖЕТНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГАУЗ|ГБУЗ)\s+/,"")
    .replace(/\s+Г\.\s*(?:КАЗАНИ|КАЗАНЬ|НАБЕРЕЖНЫЕ ЧЕЛНЫ|Н\.\s*ЧЕЛНЫ)$/,"")
    .replace(/\bГКБ\b/g,"ГКБ")
    .replace(/(?:^|\s)ГКБ(?=\s|№)/g," ГОРОДСКАЯ КЛИНИЧЕСКАЯ БОЛЬНИЦА")
    .replace(/(?:^|\s)ДГП(?=\s|№)/g," ДЕТСКАЯ ГОРОДСКАЯ ПОЛИКЛИНИКА")
    .replace(/(?:^|\s)ГП(?=\s|№)/g," ГОРОДСКАЯ ПОЛИКЛИНИКА")
    .replace(/(?:^|\s)ЦРБ(?=\s|$)/g," ЦЕНТРАЛЬНАЯ РАЙОННАЯ БОЛЬНИЦА")
    .replace(/\s*№\s*/g," №").replace(/\s+/g," ").trim();
}
export function matchVitrinaOrganizations(rows, incident) {
  const candidates = rows.map(row => {
    if (!row.now) return {row, matches:[]};
    const name = comparableName(row.name);
    const addressText = locality(row.name+" "+row.rows.map(x=>x.address).join(" "));
    return {row,matches:incident.filter(org => comparableName(org.name)===name && Boolean(org.city) && addressText.includes(locality(org.city)))};
  });
  const uses = new Map();
  for(const {matches} of candidates) for(const m of matches) uses.set(m.oid,(uses.get(m.oid)??0)+1);
  return candidates.map(({row,matches})=>({id:row.id,oid:matches.length===1 && uses.get(matches[0].oid)===1 ? matches[0].oid : null}));
}
export function summarizeVitrinaIssues(rows,issues) {
  const leadingComma=rows.filter(r=>String(r.address??"").trim().startsWith(",")).length;
  const names=issues.filter(i=>i.category==="Наименования"&&i.level==="review").length;
  const empty=issues.filter(i=>i.level==="confirmed").length;
  const other=issues.filter(i=>i.category==="Адреса"&&i.level==="review"&&!String(i.original??"").trim().startsWith(",")).length;
  return {leadingComma,names,empty,other};
}
/** Only known punctuation-only alias: identical full source name except quote marks. */
export function scheduleIdentity(value) {
  return String(value).replace(/[«»"]/g,"").replace(/\s+/g," ").trim();
}
