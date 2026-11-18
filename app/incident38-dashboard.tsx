"use client";

import { useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type Tab = "overview" | "organization" | "matrix";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const ORGANIZATIONS = DATA.flatMap((dataset) => dataset.orgs);
const SPECIALTIES = [...new Map(DATA.flatMap((dataset) => dataset.specialties).map((s) => [s.code, s])).values()];
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const shortfall = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
const rowsFor = (org: Organization) => org.specialties.filter((row) => row.norm === null || row.norm > 0);
function metrics(rows: Specialty[]) {
  const applicable = rowsFor({ specialties: rows } as Organization);
  const norm = sumKnown(applicable.map((row) => row.norm));
  const epguSlots = sumKnown(applicable.map((row) => row.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const allValuesPresent = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
  const deficit = allValuesPresent ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
  return { norm, epguSlots, coverage, deficit, below: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length, zero: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots === 0).length, missing: applicable.filter((row) => row.norm === null || (row.norm > 0 && row.epguSlots === null)).length, applicable: applicable.filter((row) => row.norm !== null && row.norm > 0).length };
}
const orgMetrics = (org: Organization) => metrics(org.specialties);
const tone = (p: number | null) => p === null ? styles.neutral : p < 50 ? styles.critical : p < 75 ? styles.attention : styles.good;
const status = (p: number | null) => p === null ? "Нет данных" : p < 50 ? "Критично" : p < 75 ? "Требует внимания" : "Близко к норме";
const shade = (p: number | null) => p === null ? "#e8eef3" : p < 25 ? "#c53e45" : p < 50 ? "#df8420" : p < 75 ? "#d8b51d" : "#27865f";
const shownOrgName = (org: Organization) => org.name;

export default function Incident38Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedOid, setSelectedOid] = useState("");
  const [search, setSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixSort, setMatrixSort] = useState("risk");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [matrixOrder, setMatrixOrder] = useState(true);

  const regional = useMemo(() => metrics(ORGANIZATIONS.flatMap((org) => org.specialties)), []);
  const organizationRows = useMemo(() => ORGANIZATIONS.map((org) => ({ org, ...orgMetrics(org) })).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), []);
  const selectedOrg = ORGANIZATIONS.find((org) => org.oid === selectedOid) ?? ORGANIZATIONS[0] ?? null;
  const specRows = useMemo(() => SPECIALTIES.map((spec) => {
    const cells = ORGANIZATIONS.flatMap((org) => org.specialties.filter((row) => row.code === spec.code));
    const applicable = cells.filter((row) => row.norm === null || row.norm > 0);
    const norm = sumKnown(applicable.map((row) => row.norm));
    const slots = sumKnown(applicable.map((row) => row.epguSlots));
    const coverage = ratio(slots, norm);
    const complete = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
    const deficit = complete ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
    return { ...spec, norm, slots, coverage, deficit, organizations: applicable.filter((row) => row.norm !== null && row.norm > 0).length,
      below: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length,
      missing: applicable.filter((row) => row.norm === null || (row.norm > 0 && row.epguSlots === null)).length };
  }).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), []);

  const filteredRanking = organizationRows.filter((row) => shownOrgName(row.org).toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  const matrixRows = organizationRows
    .filter(({ org }) => shownOrgName(org).toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru")))
    .sort((a, b) => matrixSort === "name" ? shownOrgName(a.org).localeCompare(shownOrgName(b.org), "ru") : matrixSort === "best" ? (b.coverage ?? -1) - (a.coverage ?? -1) : (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY));
  const selectedSpecialties = selectedOrg ? selectedOrg.specialties.map((row) => ({ ...row, coverage: ratio(row.epguSlots, row.norm), deficit: shortfall(row.epguSlots, row.norm) })).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)) : [];
  const criticalCount = organizationRows.filter((row) => row.coverage !== null && row.coverage < 50).length;
  const attentionCount = organizationRows.filter((row) => row.coverage !== null && row.coverage >= 50 && row.coverage < 75).length;
  const nearCount = organizationRows.filter((row) => row.coverage !== null && row.coverage >= 75).length;
  const riskCount = (org: Organization) => org.specialties.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots / row.norm < .5).length;
  const currentIndex = selectedOrg ? organizationRows.findIndex((row) => row.org.oid === selectedOrg.oid) : -1;

  function openOrg(oid: string) { setSelectedOid(oid); setTab("organization"); }
  function selectNeighbor(direction: -1 | 1) {
    const next = organizationRows[Math.min(organizationRows.length - 1, Math.max(0, currentIndex + direction))];
    if (next) setSelectedOid(next.org.oid);
  }

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>РАЗДЕЛ И38 · ФОРМА И-38.9</p><h1>Слоты ЕПГУ по нормативам</h1>
        <p className={styles.subtitle}>Свободные слоты на ближайшие 14 дней · объединены все МО из двух выгрузок</p>
        <p className={styles.sourceDates}>Даты выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" · ")} · актуальность ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</p>
      </div>
      <div className={styles.heroResult}><span>Общее выполнение норматива</span><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><small>{format(regional.epguSlots)} слотов ЕПГУ из {format(regional.norm)} по общему нормативу</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
      <button className={tab === "matrix" ? styles.tabActive : ""} onClick={() => setTab("matrix")}>Матрица МО × специальности</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.kpis}>
        <article className={styles.kpi}><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><span>Слоты ЕПГУ от общего норматива</span><small>{format(regional.epguSlots)} свободных слотов ÷ {format(regional.norm)} требуемых</small></article>
        <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Суммарно не хватает слотов ЕПГУ</span><small>Сумма нехватки по каждой МО и специальности</small></article>
        <article className={styles.kpi}><strong className={styles.critical}>{criticalCount}</strong><span>МО с критическим уровнем (&lt;50%)</span><small>Из {organizationRows.length} медицинских организаций</small></article>
        <article className={styles.kpi}><strong className={styles.attention}>{attentionCount}</strong><span>МО требуют внимания (50–&lt;75%)</span><small>Доступно от половины до трёх четвертей норматива</small></article>
        <article className={styles.kpi}><strong className={styles.good}>{nearCount}</strong><span>МО близки к нормативу (≥75%)</span><small>Шкала статусов повторяет предоставленный образец</small></article>
      </div>
      <div className={styles.note}><b>Как читать:</b> <span>норматив — сколько слотов требуется;</span> <span>слоты ЕПГУ — сколько свободных мест открыто для записи через Госуслуги;</span> <span>выполнение = слоты ЕПГУ ÷ общий норматив;</span> <span>полное выполнение — 100%.</span><br/><span>Цветовые границы 50% и 75% перенесены из образца и служат визуальными ориентирами, это не отдельный норматив оценки.</span></div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Выполнение по специальностям <small>% от общего норматива</small></h2>
          <div className={styles.barList}>{specRows.map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i style={{width:`${Math.min(100,Math.max(0,row.coverage ?? 0))}%`,background:shade(row.coverage)}} /></div><b className={tone(row.coverage)}>{percent(row.coverage)}</b></div>)}</div>
        </section>
        <section className={styles.card}><h2>Нехватка слотов по специальностям <small>слотов до общего норматива</small></h2>
          <div className={styles.barList}>{[...specRows].sort((a,b)=>(b.deficit ?? -1)-(a.deficit ?? -1)).map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i className={styles.deficitFill} style={{width:`${Math.min(100,Math.max(0,(row.deficit ?? 0)/(Math.max(1,...specRows.map((x)=>x.deficit ?? 0)))*100))}%`}} /></div><b>{format(row.deficit)}</b></div>)}</div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>Список единый для всех МО, сортировка от наименьшего выполнения. Нажмите на строку для карточки организации.</p></div><label className={styles.search}>Поиск МО<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Введите название" /></label></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>№</th><th>Медицинская организация</th><th>% выполнения</th><th>Статус</th><th>Общий норматив, слотов</th><th>Свободно на ЕПГУ, слотов</th><th>Не хватает, слотов</th><th>Профиль риска, специальностей &lt;50%</th></tr></thead><tbody>
          {filteredRanking.map((row,i)=><tr key={row.org.oid} onClick={()=>openOrg(row.org.oid)}><td>{i+1}</td><td className={styles.orgName}>{row.org.name}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td><span className={`${styles.status} ${tone(row.coverage)}`}>{status(row.coverage)}</span></td><td>{format(row.norm)}</td><td>{format(row.epguSlots)}</td><td>{format(row.deficit)}</td><td>{riskCount(row.org)}</td></tr>)}
        </tbody></table></div>
        {filteredRanking.length===0&&<p className={styles.empty}>МО по такому названию не найдены.</p>}
        <div className={styles.legend}><span><i style={{background:"#c53e45"}} />&lt;50% — критично</span><span><i style={{background:"#df8420"}} />50–&lt;75% — требует внимания</span><span><i style={{background:"#27865f"}} />≥75% — близко к норме</span></div>
      </section>
    </main>}

    {tab === "organization" && <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.orgPicker}><label>Медицинская организация<select value={selectedOrg?.oid ?? ""} onChange={(e)=>setSelectedOid(e.target.value)}>{organizationRows.map(({org},i)=><option key={org.oid} value={org.oid}>{i+1}. {org.name}</option>)}</select></label>
          <button onClick={()=>selectNeighbor(-1)} disabled={currentIndex>=organizationRows.length-1}>← Хуже</button><button onClick={()=>selectNeighbor(1)} disabled={currentIndex<=0}>Лучше →</button><span className={styles.position}>{currentIndex+1} из {organizationRows.length} · по уровню выполнения</span></div>
      </section>
      {selectedOrg && <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>Карточка МО · свободные слоты для записи на 14 дней · ЕПГУ означает запись через Госуслуги</p></div><span className={`${styles.status} ${tone(orgMetrics(selectedOrg).coverage)}`}>{status(orgMetrics(selectedOrg).coverage)}</span></div>
        <div className={styles.orgKpis}>
          <article><strong className={tone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>Слоты ЕПГУ от общего норматива</span><small>{format(orgMetrics(selectedOrg).epguSlots)} из {format(orgMetrics(selectedOrg).norm)}</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает слотов до норматива</span><small>сумма по специальностям МО</small></article>
          <article><strong>{orgMetrics(selectedOrg).below} из {orgMetrics(selectedOrg).applicable}</strong><span>Специальностей ниже нормы</span><small>норматив больше нуля</small></article>
          <article><strong>{orgMetrics(selectedOrg).missing}</strong><span>Специальностей без полных данных</span><small>нет всех значений для расчёта</small></article>
        </div>
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>Процент И38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО». «Норма для ЕПГУ» и «Всего слотов» также показаны отдельно из исходной формы.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(e)=>setSelectedSpecialty(e.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((spec)=><option key={spec.code} value={spec.code}>{spec.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Всего слотов</th><th>Норма для ЕПГУ</th><th>Слотов для ЕПГУ</th><th>Выполнение И38.9, %</th><th>Не хватает до общего норматива</th></tr></thead><tbody>
          {selectedSpecialties.filter((row)=>!selectedSpecialty||row.code===selectedSpecialty).map((row)=><tr key={row.code}><td className={styles.orgName}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td>{format(row.deficit)}</td></tr>)}
        </tbody></table></div>
      </section>}
    </main>}

    {tab === "matrix" && <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Тепловая карта: все МО × специальности</h2><p>В ячейке — выполнение И38.9: слоты ЕПГУ ÷ общий норматив. «Н» — норматив не задан; «—» — нет данных. Нажмите ячейку или МО, чтобы открыть карточку.</p></div>
          <div className={styles.matrixControls}><label>Поиск МО<input value={matrixSearch} onChange={(e)=>setMatrixSearch(e.target.value)} placeholder="Введите название" /></label><label>Сортировка<select value={matrixSort} onChange={(e)=>setMatrixSort(e.target.value)}><option value="risk">Сначала ниже выполнение</option><option value="best">Сначала выше выполнение</option><option value="name">По названию МО</option></select></label></div></div>
        <div className={styles.matrixScroll}><table className={styles.heat}><thead><tr><th className={styles.stickyName}>Медицинская организация</th>{SPECIALTIES.map((spec)=><th className={styles.rot} key={spec.code} title={spec.name}>{spec.name}</th>)}<th className={styles.rot}>Итого</th></tr></thead><tbody>
          {matrixRows.map(({org,...m})=><tr key={org.oid}><th className={styles.stickyName} onClick={()=>openOrg(org.oid)}>{org.name}</th>{SPECIALTIES.map((spec)=>{const cell=org.specialties.find((x)=>x.code===spec.code);const p=cell?ratio(cell.epguSlots,cell.norm):null;const text=!cell||cell.norm===null?"—":cell.norm<=0?"Н":p===null?"—":`${Math.round(p)}`;const title=!cell?"Нет строки по специальности":cell.norm===null?"Нет норматива в данных":cell.norm<=0?"Норматив не задан":`${spec.name}: ${percent(p)} · ЕПГУ ${format(cell.epguSlots)} из общего норматива ${format(cell.norm)}`;return <td key={spec.code} title={title} onClick={()=>{setSelectedOid(org.oid);setSelectedSpecialty(spec.code);setTab("organization")}} style={{background:text==="Н"?"#e8eef3":shade(p),color:text==="Н"?"#8398ad":"#fff"}}>{text}</td>})}
            <td title={`Итого: ${percent(m.coverage)} · ${format(m.epguSlots)} из ${format(m.norm)}`} onClick={()=>openOrg(org.oid)} style={{background:shade(m.coverage),color:"#fff",fontWeight:800}}>{m.coverage===null?"—":Math.round(m.coverage)}</td></tr>)}
        </tbody></table></div>
        <div className={styles.legend}><span><i style={{background:"#c53e45"}} />&lt;25%</span><span><i style={{background:"#df8420"}} />25–&lt;50%</span><span><i style={{background:"#d8b51d"}} />50–&lt;75%</span><span><i style={{background:"#27865f"}} />≥75%</span><span><i style={{background:"#e8eef3"}} />Н — норматив не задан</span></div>
      </section>
    </main>}

    <footer className={styles.footer}>Источник: форма И-38.9, лист «И_38.9». Процент соответствует исходному полю «Реальный процент для ЕПГУ»: доступные слоты ЕПГУ ÷ «Норматив ВСЕГО» × 100%. Выгрузки объединены в один перечень МО; срезы получены в разные даты, указанные в шапке. Отсутствие данных не заменяется нулём.</footer>
  </div>;
}
