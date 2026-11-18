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
      <div><p className={styles.kicker}>ОТДЕЛЬНЫЙ РАЗДЕЛ ДАШБОРДА · И38</p><h1>Запись к врачу: норматив и свободные слоты</h1><p className={styles.subtitle}>Единый список медицинских организаций · доступность записи на ближайшие 14 дней</p></div>
      <div className={styles.dateBox}><span>Даты исходных выгрузок</span><strong>{DATA.map((dataset) => dataset.reportDate).join(" · ")}</strong><small>ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</small></div>
    </header>

    <nav className={styles.breadcrumb} aria-label="Уровень детализации">
      <button type="button" className={!selectedOrg ? styles.crumbActive : ""} onClick={() => setSelectedOid("")}>МЗ РТ · все МО</button>
      {selectedOrg && <><span>›</span><strong>{selectedOrg.name}</strong></>}
    </nav>

    {!selectedOrg ? <>
      <section className={styles.cards} aria-label="Сводка Министерства здравоохранения">
        <article className={styles.card}><span>МО в расчёте</span><strong>{numberFormat.format(ORGANIZATIONS.length)}</strong><small>организации из двух исходных выгрузок</small></article>
        <article className={styles.card}><span>МО ниже норматива</span><strong className={organizationsBelow ? styles.warn : styles.good}>{organizationsBelow} из {ORGANIZATIONS.length}</strong><small>свободных слотов меньше, чем требуется</small></article>
        <article className={styles.card}><span>Выполнение общей нормы</span><strong className={tone(allMetrics.coverage)}>{percent(allMetrics.coverage)}</strong><small>{format(allMetrics.slots)} свободно из {format(allMetrics.norm)} требуемых слотов</small><div className={styles.meter}><i style={{width:`${Math.min(100,allMetrics.coverage ?? 0)}%`}} /></div></article>
        <article className={styles.card}><span>Не хватает слотов до общей нормы</span><strong>{format(allMetrics.deficit)}</strong><small>нехватка сложена отдельно по каждой МО и специальности</small></article>
        <article className={styles.card}><span>Норма записи через Госуслуги (ЕПГУ)</span><strong className={tone(allMetrics.epguCoverage)}>{percent(allMetrics.epguCoverage)}</strong><small>{format(allMetrics.epguSlots)} доступно из {format(allMetrics.epguNorm)} требуемых · не хватает {format(allMetrics.epguDeficit)}</small><div className={styles.meter}><i style={{width:`${Math.min(100,allMetrics.epguCoverage ?? 0)}%`}} /></div></article>
        <article className={styles.card}><span>МО, где по специальности нет слотов</span><strong className={criticalOrganizations ? styles.bad : styles.good}>{criticalOrganizations}</strong><small>по одной или нескольким специальностям доступно 0 слотов</small></article>
      </section>
      <div className={styles.signalStrip}><span><b>{totalProblemCells}</b> случаев, когда по МО доступно меньше слотов, чем требуется по специальности</span><span><b>{incompleteOrganizations}</b> МО без полных данных</span><span><b>{specialtyRows.filter((row) => row.coverage !== null && row.coverage < 100).length}</b> специальностей, где суммарно доступно меньше слотов, чем требуется</span></div>
      <p className={styles.cutNotice}>Данные взяты из двух исходных выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" и ")}. Даты показаны здесь один раз; по МО список общий. Если значение отсутствует, оно не считается нулём.</p>\n      <div className={styles.readGuide}><b>Как читать:</b><span><strong>Норма</strong> — сколько слотов требуется</span><span><strong>Доступно</strong> — сколько свободных слотов открыто для записи</span><span><strong>Выполнение</strong> = доступно ÷ норма</span><span><strong>Нехватка</strong> = сколько слотов не хватает до нормы</span><span><strong>ЕПГУ</strong> — запись через Госуслуги, считается отдельно</span></div>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Сводка по специальностям</h2><p>Для каждой специальности сравниваем требуемое и фактически доступное число свободных слотов на 14 дней. Нехватка считается отдельно в каждой МО: избыток в одной организации не закрывает дефицит другой.</p></div><button type="button" className={styles.clearButton} onClick={() => setSpecialtyCode("")}>Все специальности</button></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th title="Число МО, где для специальности установлено требование">МО с нормативом</th><th title="Сколько свободных слотов требуется">Требуется слотов</th><th title="Сколько свободных слотов доступно для записи">Свободно слотов</th><th title="Сумма нехватки по МО">Не хватает слотов</th><th title="Свободно слотов ÷ требуется слотов">Норма обеспечена, %</th><th>МО ниже нормы</th><th>МО без слотов</th><th title="В исходных данных не хватает значений для расчёта">МО без данных</th></tr></thead><tbody>
          {specialtyRows.map((row) => <tr key={row.code} className={specialtyCode === row.code ? styles.selectedRow : ""}><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => setSpecialtyCode(row.code)}>{row.name} <span>→</span></button></td><td>{row.organizations}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.deficit)}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td>{row.organizationsBelow}</td><td>{row.organizationsZero}</td><td>{row.missing}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>{specialtyCode ? `Показатели по специальности «${selectedSpecialty?.name}»` : "Сначала МО, где свободных слотов меньше, чем требуется. Нажмите на название, чтобы открыть детализацию."} Список общий — без разделения на города и районы.</p></div><span className={styles.countBadge}>{displayedOrganizations.length} МО</span></div>
        <div className={styles.filters}>
          <label>Специальность<select value={specialtyCode} onChange={(event) => setSpecialtyCode(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label>Показывать<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Поиск МО<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название медицинской организации" /></label>
          <label>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="coverage">Сначала меньшее выполнение нормы</option><option value="deficit">Сначала большая нехватка слотов</option><option value="below">Сначала больше специальностей с нехваткой</option><option value="name">По названию</option></select></label>
        </div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Медицинская организация</th><th title="Свободные слоты ÷ требуемые слоты">{coverageTitle}</th><th>Специальностей ниже нормы</th><th>Специальностей без слотов</th><th>Не хватает слотов</th><th title="Доступность слотов для записи через Госуслуги">Норма ЕПГУ обеспечена, %</th><th>Не хватает слотов для ЕПГУ</th><th>Специальностей без данных</th></tr></thead><tbody>
          {displayedOrganizations.map((org) => <tr key={org.oid}><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => setSelectedOid(org.oid)}>{org.name} <span>→</span></button></td><td className={tone(org.metrics.coverage)}>{percent(org.metrics.coverage)}</td><td>{org.metrics.below} из {org.metrics.applicable}</td><td>{org.metrics.noSlots}</td><td>{format(org.metrics.deficit)}</td><td className={tone(org.metrics.epguCoverage)}>{percent(org.metrics.epguCoverage)}</td><td>{format(org.metrics.epguDeficit)}</td><td>{org.metrics.missing}</td></tr>)}
        </tbody></table></div>
        {displayedOrganizations.length === 0 && <p className={styles.empty}>По выбранным фильтрам МО не найдены.</p>}
      </section>
    </> : <>
      <section className={styles.orgOverview}><div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>По каждой специальности указано, сколько слотов требуется и сколько свободно для записи на ближайшие 14 дней. ЕПГУ — отдельная часть норматива для записи через Госуслуги.</p></div><button type="button" className={styles.backButton} onClick={() => setSelectedOid("")}>← К списку МО</button></div>
        <div className={styles.orgCards}><article><span>Доступные слоты от общей нормы</span><strong className={tone(selectedMetrics?.coverage ?? null)}>{percent(selectedMetrics?.coverage ?? null)}</strong></article><article><span>Сколько слотов не хватает до нормы</span><strong>{format(selectedMetrics?.deficit ?? null)}</strong></article><article><span>Специальностей с нехваткой</span><strong>{selectedMetrics?.below ?? 0} из {selectedMetrics?.applicable ?? 0}</strong></article><article><span>Доступные слоты ЕПГУ от нормы</span><strong className={tone(selectedMetrics?.epguCoverage ?? null)}>{percent(selectedMetrics?.epguCoverage ?? null)}</strong></article></div>
        <div className={styles.filters}><label>Специальность<select value={specialtyCode} onChange={(event) => setSpecialtyCode(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th title="Сколько слотов требуется">Требуется слотов</th><th title="Свободно для записи">Свободно слотов</th><th>Не хватает слотов</th><th>Норма обеспечена, %</th><th>Требуется для записи через Госуслуги</th><th>Свободно для записи через Госуслуги</th><th>Не хватает слотов ЕПГУ</th><th>Норма ЕПГУ обеспечена, %</th></tr></thead><tbody>
          {selectedSpecialties.map((row) => <tr key={row.code}><td className={styles.name}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.deficit)}</td><td className={tone(row.coverage)}>{percent(row.coverage)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td>{format(row.epguShortage)}</td><td className={tone(row.epguCoverage)}>{percent(row.epguCoverage)}</td></tr>)}
        </tbody></table></div>
      </section>
    </>}

    <footer className={styles.footer}>Формулы: выполнение = свободные слоты ÷ требуемые слоты × 100%; нехватка = max(0, требуемые − свободные). Общий дефицит складывается по каждой МО и специальности отдельно. Норматив 0 означает, что специальность к МО не применяется. Свободные слоты — это возможность записаться, а не число состоявшихся приёмов. ЕПГУ (Госуслуги) учитывается отдельным нормативом. «—» означает, что исходных данных недостаточно для расчёта; это не ноль.</footer>
  </div>;
}
