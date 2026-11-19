"use client";

import { useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import reorganizationRaw from "../config/mo-reorganizations.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type Tab = "overview" | "organization";
type Ownership = "state" | "private";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const reorganizationGroups = (reorganizationRaw as { groups?: Array<{ effectiveDate: string; predecessors?: Array<{ oldOid?: string }> }> }).groups ?? [];
const dateKey = (date: string) => {
  const [day, month, year] = date.split(".");
  return `${year}-${month}-${day}`;
};
const ORGANIZATIONS = DATA.flatMap((dataset) => {
  const reportDate = dateKey(dataset.reportDate);
  const predecessorOids = new Set(reorganizationGroups
    .filter((group) => reportDate >= group.effectiveDate)
    .flatMap((group) => (group.predecessors ?? []).map((predecessor) => predecessor.oldOid).filter((oid): oid is string => Boolean(oid))));
  return dataset.orgs.filter((org) => !predecessorOids.has(org.oid));
});
const SPECIALTIES = [...new Map(DATA.flatMap((dataset) => dataset.specialties).map((specialty) => [specialty.code, specialty])).values()];
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const PLAN_PERCENT = 70;
const PLAN_RATIO = PLAN_PERCENT / 100;
const planShortfall = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, Math.ceil(norm * PLAN_RATIO - slots - 1e-9));
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
// The three AO dental organizations in these exports have documented Republic of Tatarstan participation.
// Keep them in the public/state-participation view; classify private entities by their legal-form prefixes.
const isPrivateOrganization = (org: Organization) => /^(ООО|ЧУЗ|ИП|АНО|ЗАО|ОАО|НЧОУ)\s/i.test(org.name.trim());
function metrics(rows: Specialty[]) {
  // Match the source form: include every EPGU slot, even where the overall norm is zero.
  const norm = sumKnown(rows.map((row) => row.norm));
  const epguSlots = sumKnown(rows.map((row) => row.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const complete = rows.every((row) => row.norm !== null && row.epguSlots !== null);
  const deficit = complete ? planShortfall(epguSlots, norm) : null;
  const targetSlots = norm === null ? null : Math.ceil(norm * PLAN_RATIO);
  return {
    norm,
    epguSlots,
    coverage,
    deficit,
    targetSlots,
    complete,
    meetsPlan: coverage !== null && coverage >= PLAN_PERCENT,
    missing: rows.filter((row) => row.norm === null || row.epguSlots === null).length,
  };
}

const orgMetrics = (org: Organization) => metrics(org.specialties);
const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.belowNorm;
const planTone = (value: number | null) => value === null ? styles.neutral : value >= PLAN_PERCENT ? styles.good : styles.belowNorm;
const status = (value: number | null) => value === null ? "Нет данных" : value >= PLAN_PERCENT ? "План 70% выполнен" : "Ниже плана 70%";
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
const matrixOrgName = (org: Organization) => org.name
  .replace(/^(?:(?:РЕСПУБЛИКИ\s+ТАТАРСТАН|ФГАОУ|ФГБОУ|ФГБУ|ФГКУ|ГАУЗ|ГБУЗ|ГКУЗ|ГАУ|ГБУ|ГКУ|МБУЗ|МУЗ|ГУЗ|ООО|АО|ЧУЗ|АНО|ЗАО|ОАО|НЧОУ|ФКУ|ВО|РТ|РФ)\s+)+/i, "")
  .replace(/^\s*[«"]|[»"]\s*$/g, "")
  .trim();

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
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixTotalDirection, setMatrixTotalDirection] = useState<"asc" | "desc">("asc");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const visibleOrganizations = useMemo(() => ORGANIZATIONS
    .filter((org) => ownership === "private" ? isPrivateOrganization(org) : !isPrivateOrganization(org)), [ownership]);
  const organizationRows = useMemo(() => visibleOrganizations
    .map((org) => ({ org, ...orgMetrics(org) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);
  const selectedOrg = organizationSearch.trim()
    ? null
    : visibleOrganizations.find((org) => org.oid === selectedOid) ?? visibleOrganizations[0] ?? null;
  const regional = useMemo(() => {
    const totals = metrics(visibleOrganizations.flatMap((org) => org.specialties));
    return { ...totals, deficit: sumKnown(visibleOrganizations.map((org) => orgMetrics(org).deficit)) };
  }, [visibleOrganizations]);
  const specRows = useMemo(() => SPECIALTIES.map((specialty) => {
    const cells = visibleOrganizations.flatMap((org) => org.specialties.filter((row) => row.code === specialty.code));
    const norm = sumKnown(cells.map((row) => row.norm));
    const slots = sumKnown(cells.map((row) => row.epguSlots));
    const coverage = ratio(slots, norm);
    return {
      ...specialty,
      norm,
      slots,
      coverage,
      organizations: cells.filter((row) => row.norm !== null && row.norm > 0).length,
      missing: cells.filter((row) => row.norm === null || row.epguSlots === null).length,
    };
  }).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);

  const organizationSuggestions = organizationSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(organizationSearch.toLocaleLowerCase("ru"))).slice(0, 8)
    : [];
  const matrixSuggestions = matrixSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru"))).slice(0, 6)
    : [];
  const matrixRows = organizationRows
    .filter(({ org }) => shownOrgName(org).toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru")))
    .sort((a, b) => {
      if (a.coverage === null) return b.coverage === null ? 0 : 1;
      if (b.coverage === null) return -1;
      return matrixTotalDirection === "asc" ? a.coverage - b.coverage : b.coverage - a.coverage;
    });
  const selectedSpecialties = selectedOrg
    ? selectedOrg.specialties.map((row) => ({ ...row, coverage: ratio(row.epguSlots, row.norm) }))
      .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY))
    : [];
  const benchmarkDataset = selectedOrg
    ? DATA.find((dataset) => dataset.orgs.some((org) => org.oid === selectedOrg.oid))
    : undefined;
  const benchmarkOrganizations = benchmarkDataset
    ? ORGANIZATIONS.filter((org) => benchmarkDataset.orgs.some((candidate) => candidate.oid === org.oid))
    : [];
  const benchmarkBySpecialty = new Map(SPECIALTIES.map((specialty) => {
    const values = benchmarkOrganizations
      .map((org) => org.specialties.find((row) => row.code === specialty.code))
      .filter((row): row is Specialty => Boolean(row && row.norm !== null && row.norm > 0 && row.epguSlots !== null))
      .map((row) => row.epguSlots! / row.norm! * 100);
    return [specialty.code, { median: median(values), count: values.length }] as const;
  }));
  const completeCount = organizationRows.filter((row) => row.complete && row.meetsPlan).length;
  const belowCount = organizationRows.filter((row) => row.complete && !row.meetsPlan).length;
  const missingCount = organizationRows.filter((row) => !row.complete || row.coverage === null).length;
  const currentIndex = selectedOrg ? organizationRows.findIndex((row) => row.org.oid === selectedOrg.oid) : -1;

  function openOrg(oid: string) {
    setSelectedOid(oid);
    setOrganizationSearch("");
    setTab("organization");
  }

  function changeOwnership(value: Ownership) {
    setOwnership(value);
    setSelectedOid("");
    setOrganizationSearch("");
    setMatrixSearch("");
  }

  function toggleTotalSort() { setMatrixTotalDirection((direction) => direction === "asc" ? "desc" : "asc"); }

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>РАЗДЕЛ И38 · ФОРМА И-38.9</p><h1>Слоты ЕПГУ по нормативам</h1>
        <p className={styles.subtitle}>Свободные слоты на ближайшие 14 дней · {ownership === "state" ? "государственные" : "частные"} медицинские организации</p>
        <p className={styles.sourceDates}>Даты выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" · ")} · актуальность ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</p>
      </div>
      <div className={styles.heroResult}><span>И‑38.9 · слоты ЕПГУ от общего норматива</span><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><small>План для каждой МО — 70%</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button type="button" className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.kpis}>
        <article className={styles.kpi}><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><span>Общий процент И‑38.9</span><small>{format(regional.epguSlots)} слотов ЕПГУ ÷ {format(regional.norm)} «Норматив ВСЕГО» · взвешенный итог</small></article>
        <article className={styles.kpi}><strong className={styles.good}>{completeCount}</strong><span>МО выполнили план 70%</span><small>Процент каждой МО не ниже 70%</small></article>
        <article className={styles.kpi}><strong className={styles.belowNorm}>{belowCount}</strong><span>МО ниже плана 70%</span><small>Среди МО с полными данными</small></article>
        <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Не хватает слотов до плана</span><small>Сумма минимальной нехватки по каждой МО</small></article>
        <article className={styles.kpi}><strong className={styles.neutral}>{missingCount}</strong><span>МО с неполными данными</span><small>Неполные данные не считаются нулём</small></article>
      </div>
      <div className={styles.note}><b>Как читать показатель:</b> Реальный процент = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%. План для каждой МО — 70%. Нехватка = max(0, округление вверх(«Норматив ВСЕГО» × 70%) − «Слотов для ЕПГУ»), считается отдельно по каждой МО. Общий процент — сумма слотов ЕПГУ, делённая на сумму общего норматива. В расчёте учитываются все слоты ЕПГУ, в том числе по специальностям с нулевым нормативом. Выгрузки имеют разные даты: {DATA.map((dataset) => dataset.reportDate).join(" и ")}. «Норма для ЕПГУ» и «Всего слотов» не влияют на этот показатель.</div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Процент слотов ЕПГУ по специальностям</h2><p className={styles.chartNote}>Слоты ЕПГУ ÷ «Норматив ВСЕГО». План 70% применяется к каждой МО в целом, поэтому значения по отдельным специальностям здесь справочные.</p>
          <div className={styles.barList}>{specRows.map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i style={{ width: `${Math.min(100, Math.max(0, row.coverage ?? 0))}%`, background: heatColor(row.coverage) }} /></div><b className={tone(row.coverage)}>{percent(row.coverage)}</b></div>)}</div>
        </section>
        <section className={styles.card}><h2>План медицинских организаций</h2><p className={styles.chartNote}>Каждая МО оценивается по общему проценту И‑38.9. Перечень ниже сортируется по этому показателю; нажмите «Итого» в матрице, чтобы изменить направление.</p>
          <div className={styles.planSummary}><strong>{completeCount} из {organizationRows.length}</strong><span>МО выполнили план 70%</span><strong>{format(regional.deficit)}</strong><span>слотов не хватает до плана по всем МО</span></div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>Специальности показаны справочно. «Итого» — слоты ЕПГУ ÷ «Норматив ВСЕГО»; план каждой МО — 70%. «Не хватает» — минимальное целое число слотов до плана этой МО. Нажмите «Итого» для сортировки.</p></div>
          <div className={styles.matrixControls}>
            <OwnershipSwitch value={ownership} onChange={changeOwnership} />
            <label className={styles.matrixSearch}>Поиск по МО<div className={styles.suggestionBox}><input value={matrixSearch} onChange={(event) => setMatrixSearch(event.target.value)} placeholder="Начните вводить название" autoComplete="off" />
              {matrixSuggestions.length > 0 && <div className={styles.suggestions}>{matrixSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => openOrg(org.oid)}><strong>{matrixOrgName(org)}</strong><span>{org.city}</span></button>)}</div>}
            </div></label>
          </div>
        </div>
        <div className={styles.matrixScroll}><table className={styles.heat}><thead><tr>
          <th className={styles.stickyName}>Медицинская организация</th>
          <th className={styles.shortfallHead}>Не хватает<br />до плана</th>
          {SPECIALTIES.map((specialty) => <th className={styles.rot} key={specialty.code} title={specialty.name}><span>{specialty.name}</span></th>)}
          <th className={`${styles.rot} ${styles.totalHead}`}><button type="button" onClick={toggleTotalSort} aria-label={`Сортировать по итогу ${matrixTotalDirection === "asc" ? "по убыванию" : "по возрастанию"}`} title="Нажмите, чтобы изменить порядок сортировки">Итого {matrixTotalDirection === "asc" ? "↑" : "↓"}</button></th>
        </tr></thead><tbody>
          {matrixRows.map((row) => <tr key={row.org.oid}>
            <th className={styles.stickyName} onClick={() => openOrg(row.org.oid)} title={`${matrixOrgName(row.org)} · ${row.org.city}`}>
              <span className={styles.matrixName}>{matrixOrgName(row.org)}</span><small className={styles.matrixCity}>{row.org.city}</small>
            </th>
            <td className={styles.shortfallCell} title={`Минимум слотов до плана 70%: ${format(row.deficit)}`} onClick={() => openOrg(row.org.oid)}>{format(row.deficit)}</td>
            {SPECIALTIES.map((specialty) => {
              const cell = row.org.specialties.find((item) => item.code === specialty.code);
              const value = cell ? ratio(cell.epguSlots, cell.norm) : null;
              const text = !cell || cell.norm === null ? "—" : cell.norm <= 0 ? "Н" : value === null ? "—" : `${Math.round(value)}`;
              const title = !cell ? "Нет строки по специальности" : cell.norm === null ? "Нет норматива в данных" : cell.norm <= 0 ? "Норматив не задан" : `${specialty.name}: ${percent(value)} · ЕПГУ ${format(cell.epguSlots)} из общего норматива ${format(cell.norm)}`;
              return <td key={specialty.code} title={title} onClick={() => { setSelectedOid(row.org.oid); setSelectedSpecialty(specialty.code); setTab("organization"); }} style={{ background: text === "Н" ? "#e8eef3" : heatColor(value), color: text === "Н" ? "#657d8f" : "#fff" }}>{text}</td>;
            })}
            <td className={styles.totalCell} title={`Итого: ${percent(row.coverage)} · ${format(row.epguSlots)} из ${format(row.norm)}`} onClick={() => openOrg(row.org.oid)} style={{ background: heatColor(row.coverage === null ? null : Math.min(100, row.coverage / PLAN_PERCENT * 100)), color: "#fff" }}>{row.coverage === null ? "—" : Math.round(row.coverage)}</td>
          </tr>)}
        </tbody></table></div>
        {matrixRows.length === 0 && <p className={styles.empty}>МО по так��му названию не найдены.</p>}
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
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>И‑38.9 = слоты ЕПГУ ÷ «Норматив ВСЕГО» × 100%. План для МО — 70%; статус показывает его выполнение.</p></div><span className={`${styles.status} ${!orgMetrics(selectedOrg).complete ? styles.statusMissing : orgMetrics(selectedOrg).meetsPlan ? styles.statusComplete : styles.statusBelow}`}>{status(orgMetrics(selectedOrg).coverage)}</span></div>
        <div className={styles.orgKpis}>
          <article><strong className={planTone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>И‑38.9 · план 70%</span><small>{format(orgMetrics(selectedOrg).epguSlots)} слотов ЕПГУ из {format(orgMetrics(selectedOrg).norm)} по общему нормативу</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).targetSlots)}</strong><span>Слотов нужно для плана</span><small>70% общего норматива, округление вверх</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает до плана</span><small>минимальное число дополнительных слотов ЕПГУ</small></article>
        </div>
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>Значения по специальностям справочные: план 70% применяется к общему показателю МО. Медиана сравнивает МО с другими организациями того же набора выгрузки.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(event) => setSelectedSpecialty(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((specialty) => <option key={specialty.code} value={specialty.code}>{specialty.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Слотов для ЕПГУ</th><th>И‑38.9, %</th><th>Медиана выборки, %</th><th>Отклонение, п.п.</th><th>МО в выборке</th></tr></thead><tbody>
          {selectedSpecialties.filter((row) => !selectedSpecialty || row.code === selectedSpecialty).map((row) => {
            const benchmark = benchmarkBySpecialty.get(row.code);
            const difference = row.coverage !== null && benchmark?.median !== null && benchmark?.median !== undefined ? row.coverage - benchmark.median : null;
            return <tr key={row.code}><td className={styles.orgName}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.epguSlots)}</td><td className={`${styles.metricCell} ${tone(row.coverage)}`}>{percent(row.coverage)}</td><td>{percent(benchmark?.median ?? null)}</td><td className={difference === null ? styles.neutral : difference >= 0 ? styles.good : styles.belowNorm}>{difference === null ? "—" : <>{difference > 0 ? "+" : ""}{numberFormat.format(difference)}</>}</td><td>{benchmark?.count ?? 0}</td></tr>;
          })}
        </tbody></table></div>
        <p className={styles.chartNote}>Медиана рассчитана по МО той же выгрузки: {benchmarkOrganizations.length} организаций · срез {benchmarkDataset?.reportDate ?? "—"}. В выборку по специальности входят МО с положительным общим нормативом; нулевые значения слотов учитываются.</p>
      </section>}
    </main>}

    <footer className={styles.footer}>Источник: форма И‑38.9, лист «нормативы». Реальный процент И‑38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%; план каждой МО — 70%. Нехватка рассчитывается по каждой МО как минимальное целое число дополнительных слотов до 70% общего норматива. «Норма для ЕПГУ» и «Всего слотов» в оценке не используются. Итог по региону — отношение суммы слотов к сумме общего норматива. Даты срезов: {DATA.map((dataset) => dataset.reportDate).join(" · ")}. По правилу реорганизации Альметьевска из текущего отчёта исключены прежние МО, головная организация сохранена. Отсутствие данных не заменяется нулём; государственные/частные организации разделены по организационно-правовой форме.</footer>
  </div>;
}
