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
type Ownership = "state" | "private";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const ORGANIZATIONS = DATA.flatMap((dataset) => dataset.orgs);
const SPECIALTIES = [...new Map(DATA.flatMap((dataset) => dataset.specialties).map((specialty) => [specialty.code, specialty])).values()];
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const shortfall = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
// The three AO dental organizations in these exports have documented Republic of Tatarstan participation.
// Keep them in the public/state-participation view; classify private entities by their legal-form prefixes.
const isPrivateOrganization = (org: Organization) => /^(ООО|ЧУЗ|ИП|АНО|ЗАО|ОАО|НЧОУ)\s/i.test(org.name.trim());
const rowsFor = (org: Organization) => org.specialties.filter((row) => row.norm === null || row.norm > 0);

function metrics(rows: Specialty[]) {
  const applicable = rowsFor({ specialties: rows } as Organization);
  const norm = sumKnown(applicable.map((row) => row.norm));
  const epguSlots = sumKnown(applicable.map((row) => row.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const allValuesPresent = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
  const deficit = allValuesPresent ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
  return {
    norm,
    epguSlots,
    coverage,
    deficit,
    below: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length,
    complete: coverage !== null && coverage >= 100,
    missing: applicable.filter((row) => row.norm === null || (row.norm > 0 && row.epguSlots === null)).length,
    applicable: applicable.filter((row) => row.norm !== null && row.norm > 0).length,
  };
}

const orgMetrics = (org: Organization) => metrics(org.specialties);
const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.belowNorm;
const status = (value: number | null) => value === null ? "Нет данных" : value >= 100 ? "Норма выполнена" : "Ниже норматива";
const heatColor = (value: number | null) => {
  if (value === null) return "#e8eef3";
  const percentDone = Math.min(100, Math.max(0, value));
  const from = [190, 58, 68];
  const to = [33, 130, 87];
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * percentDone / 100));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
};
const riskClass = (count: number) => count === 0 ? styles.riskNone : count === 1 ? styles.riskOne : count === 2 ? styles.riskTwo : styles.riskThree;
const shownOrgName = (org: Organization) => org.name;

function OwnershipSwitch({ value, onChange }: { value: Ownership; onChange: (value: Ownership) => void }) {
  return <div className={styles.ownership} role="group" aria-label="Тип медицинской организации">
    <button type="button" className={value === "state" ? styles.ownershipActive : ""} onClick={() => onChange("state")}>Государственные</button>
    <button type="button" className={value === "private" ? styles.ownershipActive : ""} onClick={() => onChange("private")}>Частные</button>
  </div>;
}

export default function Incident38Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [ownership, setOwnership] = useState<Ownership>("state");
  const [selectedOid, setSelectedOid] = useState("");
  const [search, setSearch] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixSort, setMatrixSort] = useState("risk");
  const [matrixSortSpecialty, setMatrixSortSpecialty] = useState("");
  const [matrixSortDirection, setMatrixSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const visibleOrganizations = useMemo(() => ORGANIZATIONS
    .filter((org) => ownership === "private" ? isPrivateOrganization(org) : !isPrivateOrganization(org)), [ownership]);
  const organizationRows = useMemo(() => visibleOrganizations
    .map((org) => ({ org, ...orgMetrics(org) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);
  const selectedOrg = organizationSearch.trim()
    ? null
    : visibleOrganizations.find((org) => org.oid === selectedOid) ?? visibleOrganizations[0] ?? null;
  const regional = useMemo(() => metrics(visibleOrganizations.flatMap((org) => org.specialties)), [visibleOrganizations]);
  const specRows = useMemo(() => SPECIALTIES.map((specialty) => {
    const cells = visibleOrganizations.flatMap((org) => org.specialties.filter((row) => row.code === specialty.code));
    const applicable = cells.filter((row) => row.norm === null || row.norm > 0);
    const norm = sumKnown(applicable.map((row) => row.norm));
    const slots = sumKnown(applicable.map((row) => row.epguSlots));
    const coverage = ratio(slots, norm);
    const complete = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
    const deficit = complete ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
    return {
      ...specialty,
      norm,
      slots,
      coverage,
      deficit,
      organizations: applicable.filter((row) => row.norm !== null && row.norm > 0).length,
      below: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length,
      missing: applicable.filter((row) => row.norm === null || (row.norm > 0 && row.epguSlots === null)).length,
    };
  }).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);

  const filteredRanking = organizationRows.filter((row) => shownOrgName(row.org).toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  const overviewSuggestions = search.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))).slice(0, 6)
    : [];
  const organizationSuggestions = organizationSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(organizationSearch.toLocaleLowerCase("ru"))).slice(0, 8)
    : [];
  const matrixSuggestions = matrixSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru"))).slice(0, 6)
    : [];
  const matrixRows = organizationRows
    .filter(({ org }) => shownOrgName(org).toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru")))
    .sort((a, b) => {
      if (matrixSortSpecialty) {
        const aValue = ratio(a.org.specialties.find((row) => row.code === matrixSortSpecialty)?.epguSlots ?? null, a.org.specialties.find((row) => row.code === matrixSortSpecialty)?.norm ?? null);
        const bValue = ratio(b.org.specialties.find((row) => row.code === matrixSortSpecialty)?.epguSlots ?? null, b.org.specialties.find((row) => row.code === matrixSortSpecialty)?.norm ?? null);
        if (aValue === null) return bValue === null ? 0 : 1;
        if (bValue === null) return -1;
        return matrixSortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }
      return matrixSort === "name"
        ? shownOrgName(a.org).localeCompare(shownOrgName(b.org), "ru")
        : matrixSort === "best"
          ? (b.coverage ?? -1) - (a.coverage ?? -1)
          : (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY);
    });
  const selectedSpecialties = selectedOrg
    ? selectedOrg.specialties.map((row) => ({ ...row, coverage: ratio(row.epguSlots, row.norm), deficit: shortfall(row.epguSlots, row.norm) }))
      .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY))
    : [];
  const completeCount = organizationRows.filter((row) => row.complete).length;
  const belowCount = organizationRows.filter((row) => row.coverage !== null && row.coverage < 100).length;
  const missingCount = organizationRows.filter((row) => row.coverage === null || row.missing > 0).length;
  const riskCount = (org: Organization) => org.specialties.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length;
  const currentIndex = selectedOrg ? organizationRows.findIndex((row) => row.org.oid === selectedOrg.oid) : -1;

  function openOrg(oid: string) {
    setSelectedOid(oid);
    setOrganizationSearch("");
    setTab("organization");
  }

  function changeOwnership(value: Ownership) {
    setOwnership(value);
    setSelectedOid("");
    setSearch("");
    setOrganizationSearch("");
    setMatrixSearch("");
    setMatrixSortSpecialty("");
  }

  function toggleSpecialtySort(code: string) {
    setMatrixSortDirection(matrixSortSpecialty === code && matrixSortDirection === "asc" ? "desc" : "asc");
    setMatrixSortSpecialty(code);
  }

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>РАЗДЕЛ И38 · ФОРМА И-38.9</p><h1>Слоты ЕПГУ по нормативам</h1>
        <p className={styles.subtitle}>Свободные слоты на ближайшие 14 дней · {ownership === "state" ? "государственные" : "частные"} медицинские организации</p>
        <p className={styles.sourceDates}>Даты выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" · ")} · актуальность ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</p>
      </div>
      <div className={styles.heroResult}><span>Общее выполнение норматива</span><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><small>{format(regional.epguSlots)} слотов ЕПГУ из {format(regional.norm)} по общему нормативу</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button type="button" className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
      <button type="button" className={tab === "matrix" ? styles.tabActive : ""} onClick={() => setTab("matrix")}>Матрица МО × специальности</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.kpis}>
        <article className={styles.kpi}><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><span>Слоты ЕПГУ от общего норматива</span><small>{format(regional.epguSlots)} свободных слотов ÷ {format(regional.norm)} требуемых</small></article>
        <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Суммарно не хватает слотов ЕПГУ</span><small>Сумма нехватки по каждой МО и специальности</small></article>
        <article className={styles.kpi}><strong className={styles.good}>{completeCount}</strong><span>МО выполнили норматив</span><small>Доступные слоты равны нормативу или превышают его</small></article>
        <article className={styles.kpi}><strong className={styles.belowNorm}>{belowCount}</strong><span>МО ниже норматива</span><small>Доступных слотов меньше, чем требуется</small></article>
        <article className={styles.kpi}><strong className={styles.neutral}>{missingCount}</strong><span>МО с неполными данными</span><small>Расчёт может быть неполным</small></article>
      </div>
      <div className={styles.note}><b>Как читать:</b> <span>100% и выше — норматив выполнен;</span> <span>ниже 100% — есть нехватка;</span> <span>нет данных — исходные значения неполные.</span> Выполнение рассчитывается как слоты ЕПГУ ÷ общий норматив.</div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Выполнение по специальностям <small>% от общего норматива</small></h2>
          <div className={styles.barList}>{specRows.map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i style={{ width: `${Math.min(100, Math.max(0, row.coverage ?? 0))}%`, background: heatColor(row.coverage) }} /></div><b className={tone(row.coverage)}>{percent(row.coverage)}</b></div>)}</div>
        </section>
        <section className={styles.card}><h2>Нехватка слотов по специальностям <small>слотов до общего норматива</small></h2>
          <div className={styles.barList}>{[...specRows].sort((a, b) => (b.deficit ?? -1) - (a.deficit ?? -1)).map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i className={styles.deficitFill} style={{ width: `${Math.min(100, Math.max(0, (row.deficit ?? 0) / Math.max(1, ...specRows.map((item) => item.deficit ?? 0)) * 100))}%` }} /></div><b>{format(row.deficit)}</b></div>)}</div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2></div>
          <div className={styles.rankingTools}><OwnershipSwitch value={ownership} onChange={changeOwnership} />
            <label className={styles.search}>Поиск по МО<div className={styles.suggestionBox}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Начните вводить название" autoComplete="off" />
              {overviewSuggestions.length > 0 && <div className={styles.suggestions}>{overviewSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => openOrg(org.oid)}><strong>{org.name}</strong><span>{org.city}</span></button>)}</div>}
            </div></label>
          </div>
        </div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>№</th><th>Медицинская организация</th><th>Выполнение нормы</th><th>Результат</th><th>Общий норматив, слотов</th><th>Свободно на ЕПГУ, слотов</th><th>Не хватает, слотов</th><th>Специальностей ниже нормы</th></tr></thead><tbody>
          {filteredRanking.map((row, index) => <tr key={row.org.oid} onClick={() => openOrg(row.org.oid)}><td>{index + 1}</td><td className={styles.orgName}>{row.org.name}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td><span className={`${styles.status} ${row.complete ? styles.statusComplete : row.coverage === null ? styles.statusMissing : styles.statusBelow}`}>{status(row.coverage)}</span></td><td>{format(row.norm)}</td><td>{format(row.epguSlots)}</td><td>{format(row.deficit)}</td><td><span className={`${styles.riskBadge} ${riskClass(riskCount(row.org))}`} aria-label={`${riskCount(row.org)} специальностей ниже нормы`}>{riskCount(row.org)}</span></td></tr>)}
        </tbody></table></div>
        {filteredRanking.length === 0 && <p className={styles.empty}>МО по такому названию не найдены.</p>}
      </section>
    </main>}

    {tab === "organization" && <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.orgPicker}>
          <OwnershipSwitch value={ownership} onChange={changeOwnership} />
          <label>Поиск медицинской организации<div className={styles.suggestionBox}><input value={organizationSearch || selectedOrg?.name || ""} onChange={(event) => { setOrganizationSearch(event.target.value); setSelectedOid(""); }} placeholder="Начните вводить название" autoComplete="off" />
            {organizationSuggestions.length > 0 && <div className={styles.suggestions}>{organizationSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => { setSelectedOid(org.oid); setOrganizationSearch(""); }}><strong>{org.name}</strong><span>{org.city}</span></button>)}</div>}
          </div></label>
          <span className={styles.position}>{currentIndex + 1} из {organizationRows.length} · сортировка по выполнению</span>
        </div>
      </section>
      {selectedOrg && <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>Свободные слоты для записи на 14 дней · ЕПГУ — запись через Госуслуги</p></div><span className={`${styles.status} ${orgMetrics(selectedOrg).complete ? styles.statusComplete : orgMetrics(selectedOrg).coverage === null ? styles.statusMissing : styles.statusBelow}`}>{status(orgMetrics(selectedOrg).coverage)}</span></div>
        <div className={styles.orgKpis}>
          <article><strong className={tone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>Слоты ЕПГУ от общего норматива</span><small>{format(orgMetrics(selectedOrg).epguSlots)} из {format(orgMetrics(selectedOrg).norm)}</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает слотов до норматива</span><small>сумма по специальностям МО</small></article>
          <article><strong className={riskClass(orgMetrics(selectedOrg).below)}>{orgMetrics(selectedOrg).below} из {orgMetrics(selectedOrg).applicable}</strong><span>Специальностей ниже нормы</span><small>норматив больше нуля</small></article>
          <article><strong className={styles.neutral}>{orgMetrics(selectedOrg).missing}</strong><span>Специальностей без полных данных</span><small>нет всех значений для расчёта</small></article>
        </div>
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>Процент И38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО». «Норма для ЕПГУ» и «Всего слотов» также показаны отдельно из исходной формы.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(event) => setSelectedSpecialty(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((specialty) => <option key={specialty.code} value={specialty.code}>{specialty.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Всего слотов</th><th>Норма для ЕПГУ</th><th>Слотов для ЕПГУ</th><th>Выполнение И38.9, %</th><th>Не хватает до общего норматива</th></tr></thead><tbody>
          {selectedSpecialties.filter((row) => !selectedSpecialty || row.code === selectedSpecialty).map((row) => <tr key={row.code}><td className={styles.orgName}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td className={`${styles.metricCell} ${tone(row.coverage)}`}>{percent(row.coverage)}</td><td>{format(row.deficit)}</td></tr>)}
        </tbody></table></div>
      </section>}
    </main>}

    {tab === "matrix" && <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Тепловая карта: все МО × специальности</h2><p>В ячейке — выполнение И38.9: слоты ЕПГУ ÷ общий норматив. «Н» — норматив не задан; «—» — нет данных. Выберите специальность в заголовке, чтобы отсортировать МО.</p></div>
          <div className={styles.matrixControls}>
            <OwnershipSwitch value={ownership} onChange={changeOwnership} />
            <label className={styles.matrixSearch}>Поиск МО<div className={styles.suggestionBox}><input value={matrixSearch} onChange={(event) => setMatrixSearch(event.target.value)} placeholder="Название организации" autoComplete="off" />
              {matrixSuggestions.length > 0 && <div className={styles.suggestions}>{matrixSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => { setMatrixSearch(org.name); setSelectedOid(org.oid); }}><strong>{org.name}</strong><span>{org.city}</span></button>)}</div>}
            </div></label>
            <label className={styles.sortLabel}>Сортировка<select value={matrixSort} onChange={(event) => { setMatrixSort(event.target.value); setMatrixSortSpecialty(""); }}><option value="risk">Ниже выполнение</option><option value="best">Выше выполнение</option><option value="name">По названию</option></select></label>
          </div>
        </div>
        <div className={styles.matrixScroll}><table className={styles.heat}><thead><tr><th className={styles.stickyName}>Медицинская организация</th>{SPECIALTIES.map((specialty) => <th className={styles.rot} key={specialty.code} title={specialty.name}><button type="button" onClick={() => toggleSpecialtySort(specialty.code)} aria-label={`Сортировать по специальности ${specialty.name}`} title={`${specialty.name} · нажмите для сортировки`}>{specialty.name}{matrixSortSpecialty === specialty.code ? (matrixSortDirection === "asc" ? " ↑" : " ↓") : ""}</button></th>)}<th className={styles.rot}>Итого</th></tr></thead><tbody>
          {matrixRows.map(({ org, ...orgSummary }) => <tr key={org.oid}><th className={styles.stickyName} onClick={() => openOrg(org.oid)}>{org.name}</th>{SPECIALTIES.map((specialty) => {
            const cell = org.specialties.find((item) => item.code === specialty.code);
            const value = cell ? ratio(cell.epguSlots, cell.norm) : null;
            const text = !cell || cell.norm === null ? "—" : cell.norm <= 0 ? "Н" : value === null ? "—" : `${Math.round(value)}`;
            const title = !cell ? "Нет строки по специальности" : cell.norm === null ? "Нет норматива в данных" : cell.norm <= 0 ? "Норматив не задан" : `${specialty.name}: ${percent(value)} · ЕПГУ ${format(cell.epguSlots)} из общего норматива ${format(cell.norm)}`;
            return <td key={specialty.code} title={title} onClick={() => { setSelectedOid(org.oid); setSelectedSpecialty(specialty.code); setTab("organization"); }} style={{ background: text === "Н" ? "#e8eef3" : heatColor(value), color: text === "Н" ? "#657d8f" : "#fff" }}>{text}</td>;
          })}<td title={`Итого: ${percent(orgSummary.coverage)} · ${format(orgSummary.epguSlots)} из ${format(orgSummary.norm)}`} onClick={() => openOrg(org.oid)} style={{ background: heatColor(orgSummary.coverage), color: "#fff", fontWeight: 800 }}>{orgSummary.coverage === null ? "—" : Math.round(orgSummary.coverage)}</td></tr>)}
        </tbody></table></div>
        <div className={styles.legend}><span><i style={{ background: heatColor(0) }} />Нет доступных слотов</span><span><i style={{ background: heatColor(100) }} />Норматив выполнен</span><span><i style={{ background: "#e8eef3" }} />Н — норматив не задан</span></div>
      </section>
    </main>}

    <footer className={styles.footer}>Источник: форма И-38.9, лист «И_38.9». Процент соответствует исходному полю «Реальный процент для ЕПГУ»: доступные слоты ЕПГУ ÷ «Норматив ВСЕГО» × 100%. Выгрузки объединены в один перечень МО; даты срезов указаны в шапке. Отсутствие данных не заменяется нулём. Фильтр «Государственные» включает организации с подтверждённым участием Республики Татарстан; распределение по типу МО основано на организационно-правовой форме.</footer>
  </div>;
}
