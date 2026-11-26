"use client";
import { useMemo, useState } from "react";
import source from "./frmr-sp-audit-20261126.json";
import styles from "./frmr-sp-audit.module.css";

const labels: Record<string,string> = {
  oid: "OID филиала различается",
  missing: "OID не указан с одной стороны",
  inactive: "Отделение активно в неактивном филиале",
  excluded: "Указана дата исключения СП",
  name: "Название филиала различается",
};
const format = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("ru-RU").format(value);

export default function FrmrSpAudit() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [flag, setFlag] = useState("");
  const [limit, setLimit] = useState(100);
  const summary = useMemo(() => source.summary.filter(mo =>
    !query || (mo.name + " " + mo.id).toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))
  ).sort((a,b) => (b.current ?? -1)-(a.current ?? -1) || a.name.localeCompare(b.name,"ru")), [query]);
  const records = useMemo(() => source.records.filter(row =>
    (!selected || row.mo === selected) && (!flag || row.flags.includes(flag))
  ), [selected, flag]);
  const counts = Object.fromEntries(Object.keys(labels).map(key => [key, source.records.filter(row => row.flags.includes(key)).length]));
  const organization = source.summary.find(mo => mo.id === selected);
  return <section className={styles.root} data-testid="frmr-sp-audit">
    <div className={styles.intro}>
      <div><h2>Сверка филиалов и отделений с ФРМО</h2><p>Срез {source.sourceCut}. Отдельный справочный контур: строки здесь не прибавляются к показателю отсутствующих должностей в МО.</p></div>
      <span className={styles.badge}>Источник: привязка СП и отделений к ФРМО</span>
    </div>
    <div className={styles.cards}>
      <article><span>Строк в исходной привязке</span><strong>{format(source.records.length)}</strong><small>одна строка — отделение в привязке</small></article>
      <article><span>МО в своде / детализации</span><strong>{format(source.summarySourceCount)} / {format(source.detailOrganizationCount)}</strong><small>только детализация: {source.detailOnlyCount} · только свод: {source.summaryOnlyCount}</small></article>
      <article><span>Различается OID филиала</span><strong>{format(counts.oid)}</strong><small>проверить сопоставление вручную</small></article>
      <article><span>Не указан один из OID</span><strong>{format(counts.missing)}</strong><small>отсутствие значения не равно ошибке МО</small></article>
    </div>
    <details className={styles.note}><summary>Что означают признаки и как хранится история</summary>
      <p>Признаки могут встречаться в одной строке одновременно, поэтому их суммы не складываются. Различие написания названия не доказывает неверную привязку. Дату исключения и активность следует сверять с состоянием ФРМО на дату выгрузки. Записи нового или исчезнувшего СП требуют проверки состава справочника, а не автоматической оценки МО.</p>
      <p>В исходной книге также сохранены своды на {source.previousCut} и {source.historicCut}. Они показаны ниже как справочные срезы; изменение числа строк не является подтверждённым исправлением ошибок. Для следующих выгрузок сохраняем отдельный датированный срез, не переписывая историю.</p>
    </details>
    <div className={styles.layout}>
      <section className={styles.panel}>
        <h3>Медицинские организации</h3>
        <input type="search" className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти МО или код" aria-label="Поиск МО в сверке СП" />
        <div className={styles.list}>
          {summary.map(mo => <button key={mo.id} className={selected===mo.id?styles.active:""} onClick={()=>{setSelected(mo.id);setLimit(100)}}>
            <span><b>{mo.name}</b><small>Код {mo.id} · {source.previousCut}: {format(mo.previous)}{mo.old===null?"":" · "+source.historicCut+": "+format(mo.old)}</small></span><strong>{format(mo.current)}</strong>
          </button>)}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.head}><div><h3>{organization ? organization.name : "Детализация по всем МО"}</h3><p>Сначала выберите МО слева. Показаны филиал в ГИС, его привязка к ФРМО и отделение.</p></div>{selected && <button onClick={()=>setSelected(null)}>Все МО</button>}</div>
        <select className={styles.search} value={flag} onChange={e=>{setFlag(e.target.value);setLimit(100)}} aria-label="Фильтр признаков сверки">
          <option value="">Все строки</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label} · {format(counts[key])}</option>)}
        </select>
        {organization && !organization.hasDetail ? <p className={styles.note}>В детализации по этой МО строк нет. Сводка источника показана отдельно; отсутствие детализации не трактуется как ноль.</p> : <p className={styles.count}>Найдено {format(records.length)} строк. Признаки служат для проверки, не для санкций или рейтинга.</p>}
        <div className={styles.detail}>{records.slice(0,limit).map((row,i)=><article key={row.mo+"-"+i}>
          <b>{row.department || "Отделение не указано"}</b><span>{row.name} · {row.branchGis || "Филиал ГИС не указан"}</span>
          <small>ФРМО: {row.branchFrmo || "нет названия"} · OID: {row.oidFrmo || "не указан"}</small>
          <small>Привязка отделения: {row.departmentBranch || "не указана"} · OID: {row.departmentOid || "не указан"}</small>
          {row.flags.length > 0 && <div className={styles.flags}>{row.flags.map(item=><em key={item}>{labels[item]}</em>)}</div>}
        </article>)}</div>
        {records.length>limit && <button className={styles.more} onClick={()=>setLimit(limit+100)}>Показать ещё 100</button>}
      </section>
    </div>
  </section>;
}
