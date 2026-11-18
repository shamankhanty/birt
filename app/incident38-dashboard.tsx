"use client";

import { useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type Metrics = { norm: number | null; slots: number | null; deficit: number | null; coverage: number | null; epguNorm: number | null; epguSlots: number | null; epguDeficit: number | null; epguCoverage: number | null; below: number; noSlots: number; missing: number; applicable: number };
type StatusFilter = "all" | "deficit" | "epgu" | "zero" | "missing" | "met";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const ORGANIZATIONS = DATA.flatMap((dataset) => dataset.orgs);
const SPECIALTIES = DATA[0].specialties;
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const shortage = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.warn;

function calculateMetrics(rows: Specialty[]): Metrics {
  const applicable = rows.filter((row) => row.norm === null || row.norm > 0);
  const norm = sumKnown(applicable.map((row) => row.norm));
  const slots = sumKnown(applicable.map((row) => row.slots));
  const missing = applicable.filter((row) => row.norm === null || (row.norm > 0 && row.slots === null)).length;
  const below = applicable.filter((row) => row.norm !== null && row.norm > 0 && row.slots !== null && row.slots < row.norm).length;
  const noSlots = applicable.filter((row) => row.norm !== null && row.norm > 0 && row.slots === 0).length;
  const epguRows = applicable.filter((row) => row.epguNorm !== null && row.epguNorm > 0);
  const epguNorm = sumKnown(epguRows.map((row) => row.epguNorm));
  const epguSlots = sumKnown(epguRows.map((row) => row.epguSlots));
  const missingEpgu = applicable.some((row) => row.epguNorm === null || (row.epguNorm > 0 && row.epguSlots === null));
  const complete = missing === 0;
  return {
    norm,
    slots,
    deficit: complete ? sumKnown(applicable.map((row) => shortage(row.slots, row.norm))) : null,
    coverage: complete ? ratio(slots, norm) : null,
    epguNorm,
    epguSlots,
    epguDeficit: missingEpgu ? null : sumKnown(epguRows.map((row) => shortage(row.epguSlots, row.epguNorm))),
    epguCoverage: missingEpgu ? null : ratio(epguSlots, epguNorm),
    below,
    noSlots,
    missing,
    applicable: applicable.filter((row) => row.norm !== null && row.norm > 0).length,
  };
}

function organizationMetrics(org: Organization, selectedCode = "") {
  return calculateMetrics(org.specialties.filter((row) => !selectedCode || row.code === selectedCode));
}

function specialtyTotals(orgs: Organization[]) {
  return SPECIALTIES.map((specialty) => {
    const cells = orgs.flatMap((org) => org.specialties.filter((row) => row.code === specialty.code));
    const metrics = calculateMetrics(cells);
    const applicableCells = cells.filter((row) => row.norm !== null && row.norm > 0);
    return {
      ...metrics,
      code: specialty.code,
      name: specialty.name,
      organizations: applicableCells.length,
      organizationsBelow: applicableCells.filter((row) => row.slots !== null && row.slots < (row.norm ?? 0)).length,
      organizationsZero: applicableCells.filter((row) => row.slots === 0).length,
    };
  });
}

export default function Incident38Dashboard() {
  const [selectedOid, setSelectedOid] = useState("");
  const [specialtyCode, setSpecialtyCode] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("coverage");

  const allMetrics = useMemo(() => calculateMetrics(ORGANIZATIONS.flatMap((org) => org.specialties)), []);
  const specialtyRows = useMemo(() => specialtyTotals(ORGANIZATIONS).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), []);
  const organizationsBelow = useMemo(() => ORGANIZATIONS.filter((org) => organizationMetrics(org).coverage !== null && organizationMetrics(org).coverage! < 100).length, []);
  const criticalOrganizations = useMemo(() => ORGANIZATIONS.filter((org) => organizationMetrics(org).noSlots > 0).length, []);
  const incompleteOrganizations = useMemo(() => ORGANIZATIONS.filter((org) => organizationMetrics(org).missing > 0).length, []);
  const totalProblemCells = specialtyRows.reduce((sum, row) => sum + row.organizationsBelow, 0);
  const displayedOrganizations = useMemo(() => ORGANIZATIONS
    .map((org) => ({ ...org, metrics: organizationMetrics(org, specialtyCode) }))
    .filter((org) => `${org.name} ${org.fullName}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")))
    .filter((org) => statusFilter === "all" || (statusFilter === "deficit" && org.metrics.coverage !== null && org.metrics.coverage < 100) || (statusFilter === "epgu" && org.metrics.epguCoverage !== null && org.metrics.epguCoverage < 100) || (statusFilter === "zero" && org.metrics.noSlots > 0) || (statusFilter === "missing" && org.metrics.missing > 0) || (statusFilter === "met" && org.metrics.coverage !== null && org.metrics.coverage >= 100))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : sort === "deficit" ? (b.metrics.deficit ?? -1) - (a.metrics.deficit ?? -1) : sort === "below" ? b.metrics.below - a.metrics.below : (a.metrics.coverage ?? Number.POSITIVE_INFINITY) - (b.metrics.coverage ?? Number.POSITIVE_INFINITY)), [specialtyCode, statusFilter, search, sort]);
  const selectedOrg = ORGANIZATIONS.find((org) => org.oid === selectedOid) ?? null;
  const selectedMetrics = selectedOrg ? organizationMetrics(selectedOrg) : null;
  const selectedSpecialties = selectedOrg?.specialties
    .filter((row) => !specialtyCode || row.code === specialtyCode)
    .map((row) => ({ ...row, coverage: ratio(row.slots, row.norm), epguCoverage: ratio(row.epguSlots, row.epguNorm), deficit: shortage(row.slots, row.norm), epguShortage: shortage(row.epguSlots, row.epguNorm) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)) ?? [];
  const statusLabels: Record<StatusFilter, string> = { all: "Все МО", deficit: "По сумме слотов меньше нормы", epgu: "Слотов для Госуслуг меньше нормы", zero: "Нет слотов хотя бы по одной специальности", missing: "Есть специальности без полных данных", met: "По сумме слотов норма выполнена" };
  const coverageTitle = specialtyCode ? "Выполнение нормы по выбранной специальности, %" : "Выполнение общей нормы, %";
  const selectedSpecialty = SPECIALTIES.find((row) => row.code === specialtyCode);

  return <div className={styles.root}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>ОТДЕЛЬНЫЙ РАЗДЕЛ ДАШБОРДА · И38</p><h1>Доступность записи к врачу</h1><p className={styles.subtitle}>Сводка по медицинским организациям · нормативы и свободные слоты на ближайшие 14 дней</p></div>
      <div className={styles.dateBox}><span>Даты исходных выгрузок</span><strong>{DATA.map((dataset) => dataset.reportDate).join(" · ")}</strong><small>ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</small></div>
    </header>

    <nav className={styles.breadcrumb} aria-label="Уровень детализации">
      <button type="button" className={!selectedOrg ? styles.crumbActive : ""} onClick={() => setSelectedOid("")}>МЗ РТ · все МО</button>
      {selectedOrg && <><span>›</span><strong>{selectedOrg.name}</strong></>}
    </nav>

    {!selectedOrg ? <>
      <section className={styles.cards} aria-label="Сводка Министерства здравоохранения">
        <article className={styles.card}><span>МО в выгрузках</span><strong>{numberFormat.format(ORGANIZATIONS.length)}</strong><small>все медицинские организации из двух выгрузок</small></article>
        <article className={styles.card}><span>МО, где суммарно слотов меньше нормы</span><strong className={organizationsBelow ? styles.warn : styles.good}>{organizationsBelow} из {ORGANIZATIONS.length}</strong><small>покрытие ниже 100%</small></article>
        <article className={styles.card}><span>Выполнение нормы записи, %</span><strong className={tone(allMetrics.coverage)}>{percent(allMetrics.coverage)}</strong><small>Доступно {format(allMetrics.slots)} из требуемых {format(allMetrics.norm)} слотов</small></article>
        <article className={styles.card}><span>Суммарная нехватка слотов</span><strong>{format(allMetrics.deficit)}</strong><small>нехватка суммируется по каждой МО и специальности отдельно</small></article>
        <article className={styles.card}><span>Выполнение нормы онлайн-записи</span><strong className={tone(allMetrics.epguCoverage)}>{percent(allMetrics.epguCoverage)}</strong><small>ЕПГУ — запись через Госуслуги · не хватает {format(allMetrics.epguDeficit)} слотов</small></article>
        <article className={styles.card}><span>МО без слотов по специальности</span><strong className={criticalOrganizations ? styles.bad : styles.good}>{criticalOrganizations}</strong><small>по одной или нескольким специальностям доступно 0 слотов</small></article>
      </section>
      <div className={styles.signalStrip}><span><b>{totalProblemCells}</b> случаев, когда по МО доступно меньше слотов, чем требуется по специальности</span><span><b>{incompleteOrganizations}</b> МО без полных данных</span><span><b>{specialtyRows.filter((row) => row.coverage !== null && row.coverage < 100).length}</b> специальностей, где суммарно доступно меньше слотов, чем требуется</span></div>
      <p className={styles.cutNotice}>Срезы исходных файлов: {DATA.map((dataset) => dataset.reportDate).join(" и ")}. Значения сведены по МО; даты не дублируются в строках. При сравнении учитывайте, что исходные выгрузки получены в разные дни. Отсутствие значения не считается нулём.</p>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Специальности с нехваткой слотов</h2><p>Норма — сколько слотов должно быть доступно на 14 дней. Нехватка считается по каждой МО и специальности отдельно: избыток в одной МО не уменьшает нехватку другой.</p></div><button type="button" className={styles.clearButton} onClick={() => setSpecialtyCode("")}>Все специальности</button></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th>МО, где действует норма</th><th>Норма, слотов</th><th>Доступно, слотов</th><th>Не хватает, слотов</th><th>Выполнение нормы, %</th><th>МО с нехваткой</th><th>МО без слотов</th><th>МО без полных данных</th></tr></thead><tbody>
          {specialtyRows.map((row) => <tr key={row.code} className={specialtyCode === row.code ? styles.selectedRow : ""}><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => setSpecialtyCode(row.code)}>{row.name} <span>→</span></button></td><td>{row.organizations}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.deficit)}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td>{row.organizationsBelow}</td><td>{row.organizationsZero}</td><td>{row.missing}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Все медицинские организации</h2><p>{specialtyCode ? `Показатели по специальности «${selectedSpecialty?.name}»` : "Сначала организации с наименьшим покрытием общего норматива"}</p></div><span className={styles.countBadge}>{displayedOrganizations.length} МО</span></div>
        <div className={styles.filters}>
          <label>Специальность<select value={specialtyCode} onChange={(event) => setSpecialtyCode(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label>Показывать<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Поиск МО<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название медицинской организации" /></label>
          <label>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="coverage">Сначала меньшее выполнение нормы</option><option value="deficit">Сначала большая нехватка слотов</option><option value="below">Сначала больше специальностей с нехваткой</option><option value="name">По названию</option></select></label>
        </div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Медицинская организация</th><th>{coverageTitle}</th><th>Специальностей с нехваткой</th><th>Спец. без слотов</th><th>Не хватает слотов</th><th>Выполнение нормы ЕПГУ, %</th><th>Не хватает ЕПГУ, слотов</th><th>Спец. без полных данных</th></tr></thead><tbody>
          {displayedOrganizations.map((org) => <tr key={org.oid}><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => setSelectedOid(org.oid)}>{org.name} <span>→</span></button></td><td className={tone(org.metrics.coverage)}>{percent(org.metrics.coverage)}</td><td>{org.metrics.below} из {org.metrics.applicable}</td><td>{org.metrics.noSlots}</td><td>{format(org.metrics.deficit)}</td><td className={tone(org.metrics.epguCoverage)}>{percent(org.metrics.epguCoverage)}</td><td>{format(org.metrics.epguDeficit)}</td><td>{org.metrics.missing}</td></tr>)}
        </tbody></table></div>
        {displayedOrganizations.length === 0 && <p className={styles.empty}>По выбранным фильтрам МО не найдены.</p>}
      </section>
    </> : <>
      <section className={styles.orgOverview}><div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>Данные на 14 дней. ЕПГУ — запись через Госуслуги; для неё заданы отдельные норма и доступные слоты.</p></div><button type="button" className={styles.backButton} onClick={() => setSelectedOid("")}>← К списку МО</button></div>
        <div className={styles.orgCards}><article><span>Выполнение нормы, %</span><strong className={tone(selectedMetrics?.coverage ?? null)}>{percent(selectedMetrics?.coverage ?? null)}</strong></article><article><span>Дефицит слотов</span><strong>{format(selectedMetrics?.deficit ?? null)}</strong></article><article><span>Специальностей с нехваткой</span><strong>{selectedMetrics?.below ?? 0} из {selectedMetrics?.applicable ?? 0}</strong></article><article><span>Выполнение нормы ЕПГУ, %</span><strong className={tone(selectedMetrics?.epguCoverage ?? null)}>{percent(selectedMetrics?.epguCoverage ?? null)}</strong></article></div>
        <div className={styles.filters}><label>Специальность<select value={specialtyCode} onChange={(event) => setSpecialtyCode(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норма, слотов</th><th>Доступно, слотов</th><th>Не хватает, слотов</th><th>Выполнение нормы, %</th><th>Норма ЕПГУ, слотов</th><th>Доступно ЕПГУ, слотов</th><th>Не хватает ЕПГУ, слотов</th><th>Выполнение нормы ЕПГУ, %</th></tr></thead><tbody>
          {selectedSpecialties.map((row) => <tr key={row.code}><td className={styles.name}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.deficit)}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td>{format(row.epguShortage)}</td><td className={tone(row.epguCoverage)}>{percent(row.epguCoverage)}</td></tr>)}
        </tbody></table></div>
      </section>
    </>}

    <footer className={styles.footer}>Выполнение нормы = доступные слоты ÷ требуемые слоты × 100%. Нехватка = max(0, требуемые слоты − доступные слоты) и суммируется по каждой МО и специальности отдельно. Норма 0 означает, что специальность не применяется к этой МО. Свободные слоты показывают возможность записаться, а не число уже совершённых записей. ЕПГУ — запись через Госуслуги; для неё нормы и слоты учитываются отдельно. Даты источников указаны в заголовке.</footer>
  </div>;
}
