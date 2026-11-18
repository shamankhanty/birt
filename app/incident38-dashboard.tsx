"use client";

import { useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import styles from "./incident38-dashboard.module.css";

type Scope = "city" | "districts";
type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type OrgRecord = Organization & { scope: Scope; reportDate: string; frmoDate: string; source: string; territoryKey: string };
type Metrics = { norm: number | null; slots: number | null; deficit: number | null; coverage: number | null; epguNorm: number | null; epguSlots: number | null; epguDeficit: number | null; epguCoverage: number | null; below: number; noSlots: number; missing: number; applicable: number };
type Level = "region" | "territory" | "organization";
type StatusFilter = "all" | "deficit" | "epgu" | "zero" | "missing" | "met";

const DATA: Record<Scope, Dataset> = { city: cityRaw as Dataset, districts: districtRaw as Dataset };
const SCOPE_LABEL: Record<Scope, string> = { city: "Города", districts: "Районы" };
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const deficit = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
const sumKnown = (values: SlotValue[]) => values.some((v) => v === null || v === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const styleFor = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.warn;

function metricsFor(orgs: OrgRecord[], specialtyCode: string) {
  const eligible = orgs.flatMap((org) => org.specialties.filter((row) => row.norm !== null && row.norm > 0 && (!specialtyCode || row.code === specialtyCode)));
  const norm = sumKnown(eligible.map((row) => row.norm));
  const slots = sumKnown(eligible.map((row) => row.slots));
  const epguNorm = sumKnown(eligible.map((row) => row.epguNorm));
  const epguSlots = sumKnown(eligible.map((row) => row.epguSlots));
  const applicable = eligible.length;
  const missing = eligible.filter((row) => row.slots === null || row.norm === null).length;
  const below = eligible.filter((row) => row.slots !== null && row.norm !== null && row.slots < row.norm).length;
  const noSlots = eligible.filter((row) => row.slots === 0).length;
  const epguEligible = eligible.filter((row) => row.epguNorm !== null && row.epguNorm > 0);
  const missingEpgu = eligible.some((row) => row.epguNorm === null || (row.epguNorm > 0 && row.epguSlots === null));
  return {
    norm,
    slots,
    deficit: missing ? null : sumKnown(eligible.map((row) => deficit(row.slots, row.norm))),
    coverage: missing ? null : ratio(slots, norm),
    epguNorm,
    epguSlots,
    epguDeficit: missingEpgu ? null : sumKnown(epguEligible.map((row) => deficit(row.epguSlots, row.epguNorm))),
    epguCoverage: missingEpgu ? null : ratio(epguSlots, epguNorm),
    below,
    noSlots,
    missing,
    applicable,
  } satisfies Metrics;
}

function groupByTerritory(orgs: OrgRecord[], specialtyCode: string) {
  const grouped = new Map<string, OrgRecord[]>();
  for (const org of orgs) grouped.set(org.territoryKey, [...(grouped.get(org.territoryKey) ?? []), org]);
  return [...grouped.entries()].map(([key, members]) => ({
    key,
    scope: members[0].scope,
    name: members[0].city,
    reportDate: members[0].reportDate,
    organizations: members,
    metrics: metricsFor(members, specialtyCode),
  }));
}

function specialtyMetrics(org: OrgRecord, code: string) {
  const list = org.specialties.filter((item) => (!code || item.code === code) && item.norm !== null && item.norm > 0);
  const norm = sumKnown(list.map((item) => item.norm));
  const slots = sumKnown(list.map((item) => item.slots));
  const epguNorm = sumKnown(list.map((item) => item.epguNorm));
  const epguSlots = sumKnown(list.map((item) => item.epguSlots));
  const missing = list.filter((item) => item.slots === null).length;
  return {
    norm, slots,
    deficit: missing ? null : sumKnown(list.map((item) => deficit(item.slots, item.norm))),
    coverage: missing ? null : ratio(slots, norm),
    epguNorm, epguSlots,
    epguDeficit: list.some((item) => item.epguNorm !== null && item.epguNorm > 0 && item.epguSlots === null) ? null : sumKnown(list.filter((item) => item.epguNorm !== null && item.epguNorm > 0).map((item) => deficit(item.epguSlots, item.epguNorm))),
    epguCoverage: ratio(epguSlots, epguNorm),
    below: list.filter((item) => item.slots !== null && item.slots < (item.norm ?? 0)).length,
    noSlots: list.filter((item) => item.slots === 0).length,
    missing,
    applicable: list.length,
  } satisfies Metrics;
}

export default function Incident38Dashboard() {
  const [level, setLevel] = useState<Level>("region");
  const [scopeFilter, setScopeFilter] = useState<"all" | Scope>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [specialtyCode, setSpecialtyCode] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("coverage");
  const [territoryKey, setTerritoryKey] = useState("");
  const [selectedOid, setSelectedOid] = useState("");

  const orgs = useMemo(() => (Object.entries(DATA) as Array<[Scope, Dataset]>).flatMap(([scope, data]) => data.orgs.map((org) => ({
    ...org,
    scope,
    reportDate: data.reportDate,
    frmoDate: data.frmoDate,
    source: data.source,
    territoryKey: `${scope}:${org.city}`,
  }))), []);
  const specialties = DATA.city.specialties.map((item) => item);
  const currentTerritory = groupByTerritory(orgs, specialtyCode).find((item) => item.key === territoryKey) ?? null;
  const currentOrg = orgs.find((org) => org.oid === selectedOid) ?? null;

  const scopeOrganizations = useMemo(() => orgs.filter((org) => scopeFilter === "all" || org.scope === scopeFilter), [orgs, scopeFilter]);
  const territoryRows = useMemo(() => groupByTerritory(scopeOrganizations, specialtyCode)
    .filter((row) => `${row.name} ${SCOPE_LABEL[row.scope]}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")))
    .filter((row) => statusFilter === "all" || (statusFilter === "deficit" && row.metrics.coverage !== null && row.metrics.coverage < 100) || (statusFilter === "epgu" && row.metrics.epguCoverage !== null && row.metrics.epguCoverage < 100) || (statusFilter === "zero" && row.metrics.noSlots > 0) || (statusFilter === "missing" && row.metrics.missing > 0) || (statusFilter === "met" && row.metrics.coverage !== null && row.metrics.coverage >= 100))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : sort === "deficit" ? (b.metrics.deficit ?? -1) - (a.metrics.deficit ?? -1) : sort === "organizations" ? b.organizations.length - a.organizations.length : (a.metrics.coverage ?? Number.POSITIVE_INFINITY) - (b.metrics.coverage ?? Number.POSITIVE_INFINITY)), [scopeOrganizations, specialtyCode, search, statusFilter, sort]);
  const territoryOrganizations = useMemo(() => (currentTerritory?.organizations ?? [])
    .filter((org) => `${org.name} ${org.fullName} ${org.code} ${org.city}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")))
    .map((org) => ({ ...org, metrics: specialtyMetrics(org, specialtyCode) }))
    .filter((org) => statusFilter === "all" || (statusFilter === "deficit" && org.metrics.coverage !== null && org.metrics.coverage < 100) || (statusFilter === "epgu" && org.metrics.epguCoverage !== null && org.metrics.epguCoverage < 100) || (statusFilter === "zero" && org.metrics.noSlots > 0) || (statusFilter === "missing" && org.metrics.missing > 0) || (statusFilter === "met" && org.metrics.coverage !== null && org.metrics.coverage >= 100))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : sort === "deficit" ? (b.metrics.deficit ?? -1) - (a.metrics.deficit ?? -1) : (a.metrics.coverage ?? Number.POSITIVE_INFINITY) - (b.metrics.coverage ?? Number.POSITIVE_INFINITY)), [currentTerritory, specialtyCode, search, statusFilter, sort]);
  const currentOrgRows = currentOrg?.specialties.filter((item) => !specialtyCode || item.code === specialtyCode)
    .map((item) => ({ ...item, coverage: ratio(item.slots, item.norm), epguCoverage: ratio(item.epguSlots, item.epguNorm), gap: deficit(item.slots, item.norm) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)) ?? [];

  const regionStats = (scope: Scope) => {
    const subset = orgs.filter((org) => org.scope === scope);
    const metrics = metricsFor(subset, specialtyCode);
    const territories = groupByTerritory(subset, specialtyCode);
    return { subset, metrics, territories, atRisk: territories.filter((row) => row.metrics.coverage !== null && row.metrics.coverage < 100).length };
  };
  const cityStats = regionStats("city");
  const districtStats = regionStats("districts");
  const heading = level === "region" ? "Сводка МЗ РТ" : level === "territory" ? currentTerritory?.name ?? "Территория" : currentOrg?.name ?? "Медицинская организация";
  const chooseTerritory = (key: string) => { setTerritoryKey(key); setLevel("territory"); setSearch(""); setSelectedOid(""); };
  const backToRegion = () => { setLevel("region"); setSearch(""); setSelectedOid(""); };
  const chooseOrganization = (oid: string) => { setSelectedOid(oid); setLevel("organization"); };
  const statusLabel: Record<StatusFilter, string> = { all: level === "region" ? "Все территории" : "Все МО", deficit: "Покрытие ниже 100%", epgu: "Дефицит квоты ЕПГУ", zero: "Есть специальности без слотов", missing: "Есть пропуски данных", met: "Норматив выполнен" };
  const coverageLabel = specialtyCode ? "Покрытие выбранной специальности" : "Покрытие общего норматива";

  return <div className={styles.root}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>ОТДЕЛЬНЫЙ РАЗДЕЛ ДАШБОРДА · И38</p><h1>Доступность записи к врачу</h1><p className={styles.subtitle}>Свободные слоты по 14 обязательным специальностям и нормативам на ближайшие 14 дней</p></div>
      <div className={styles.dateBox}><span>Источники данных</span><strong>Города · {DATA.city.reportDate}</strong><strong>Районы · {DATA.districts.reportDate}</strong><small>Срезы разных дат показаны раздельно</small></div>
    </header>

    <nav className={styles.breadcrumb} aria-label="Уровень детализации">
      <button type="button" className={level === "region" ? styles.crumbActive : ""} onClick={backToRegion}>МЗ РТ</button>
      {level !== "region" && <><span>›</span><button type="button" className={level === "territory" ? styles.crumbActive : ""} onClick={backToRegion}>{currentTerritory?.name ?? "Территории"}</button></>}
      {level === "organization" && <><span>›</span><strong>{currentOrg?.name}</strong></>}
    </nav>

    <section className={styles.cards} aria-label="Сводка Министерства здравоохранения">
      {([ ["city", cityStats], ["districts", districtStats] ] as const).map(([scope, stats]) => <article className={styles.summaryCard} key={scope}>
        <div className={styles.summaryTitle}><span>{SCOPE_LABEL[scope]} · срез {DATA[scope].reportDate}</span><strong>{stats.subset.length} МО</strong></div>
        <div className={styles.summaryMetrics}><div><small>Покрытие норматива</small><b className={styleFor(stats.metrics.coverage)}>{percent(stats.metrics.coverage)}</b></div><div><small>Территорий с дефицитом</small><b>{stats.atRisk} из {stats.territories.length}</b></div><div><small>Дефицит слотов</small><b>{format(stats.metrics.deficit)}</b></div><div><small>Дефицит ЕПГУ</small><b>{format(stats.metrics.epguDeficit)}</b></div></div>
      </article>)}
    </section>
    <p className={styles.cutNotice}>Сводные значения городов и районов не складываются: выгрузки имеют разные даты среза. Внутри каждого набора агрегат рассчитывается как сумма свободных слотов ÷ сумма норматива. ЕПГУ оценивается отдельно.</p>

    <section className={styles.panel}>
      <div className={styles.sectionHead}><div><h2>{level === "region" ? "Территории и уровень выполнения" : level === "territory" ? `Медицинские организации · ${currentTerritory?.name ?? ""}` : `Детализация МО · ${currentOrg?.name ?? ""}`}</h2><p>{level === "region" ? "Нажмите на территорию, чтобы перейти к списку МО; срез даты показан для каждой строки" : level === "territory" ? "Выберите МО для разбора дефицита по специальностям" : "Показаны норматив и свободные слоты по каждой специальности"}</p></div>{level !== "region" && <button className={styles.backButton} type="button" onClick={level === "organization" ? () => setLevel("territory") : backToRegion}>← {level === "organization" ? "К списку МО" : "К сводке МЗ РТ"}</button>}</div>
      <div className={styles.filters}>
        {level === "region" && <label>Тип территории<select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as "all" | Scope)}><option value="all">Города и районы</option><option value="city">Города</option><option value="districts">Районы</option></select></label>}
        <label>Специальность<select value={specialtyCode} onChange={(event) => setSpecialtyCode(event.target.value)}><option value="">Все 14 специальностей</option>{specialties.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        {level !== "organization" && <>
          <label>Проблема<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Поиск<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={level === "region" ? "Город или район" : "Название МО или код"} /></label>
          <label>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="coverage">Сначала низкое покрытие</option><option value="deficit">Сначала большой дефицит</option><option value="organizations">Сначала больше МО</option><option value="name">По названию</option></select></label>
        </>}
      </div>

      {level === "region" && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Тип</th><th>Город / район</th><th>МО</th><th>Срез</th><th>{coverageLabel}</th><th>МО с дефицитом</th><th>Спец. ниже нормы</th><th>Нет слотов</th><th>Дефицит слотов</th><th>Покрытие ЕПГУ</th></tr></thead><tbody>
        {territoryRows.map((row) => { const atRisk = row.organizations.filter((org) => specialtyMetrics(org, specialtyCode).coverage !== null && specialtyMetrics(org, specialtyCode).coverage! < 100).length; return <tr key={row.key} className={styles.clickableRow}><td><span className={row.scope === "city" ? styles.cityBadge : styles.districtBadge}>{SCOPE_LABEL[row.scope]}</span></td><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => chooseTerritory(row.key)}>{row.name} <span>→</span></button></td><td>{row.organizations.length}</td><td>{row.reportDate}</td><td className={styleFor(row.metrics.coverage)}>{percent(row.metrics.coverage)}</td><td>{atRisk}</td><td>{row.metrics.below}</td><td>{row.metrics.noSlots}</td><td>{format(row.metrics.deficit)}</td><td className={styleFor(row.metrics.epguCoverage)}>{percent(row.metrics.epguCoverage)}</td></tr>; })}
      </tbody></table></div>}

      {level === "territory" && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Медицинская организация</th><th>Код МО</th><th>Срез</th><th>{coverageLabel}</th><th>Специальностей ниже нормы</th><th>Нет слотов</th><th>Дефицит слотов</th><th>Покрытие ЕПГУ</th><th>Пропуски</th></tr></thead><tbody>
        {territoryOrganizations.map((org) => <tr key={org.oid} className={styles.clickableRow}><td className={styles.name}><button type="button" className={styles.rowLink} onClick={() => chooseOrganization(org.oid)}>{org.name} <span>→</span></button></td><td>{org.code}</td><td>{org.reportDate}</td><td className={styleFor(org.metrics.coverage)}>{percent(org.metrics.coverage)}</td><td>{org.metrics.below} из {org.metrics.applicable}</td><td>{org.metrics.noSlots}</td><td>{format(org.metrics.deficit)}</td><td className={styleFor(org.metrics.epguCoverage)}>{percent(org.metrics.epguCoverage)}</td><td>{org.metrics.missing}</td></tr>)}
      </tbody></table></div>}

      {level === "organization" && currentOrg && <>
        <div className={styles.orgHeading}><div><strong>{currentOrg.name}</strong><span>{SCOPE_LABEL[currentOrg.scope]} · {currentOrg.city} · код МО {currentOrg.code}</span></div><span className={styles.oid}>OID {currentOrg.oid}</span></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив</th><th>Свободные слоты</th><th>Дефицит</th><th>Покрытие</th><th>Норматив ЕПГУ</th><th>Слоты ЕПГУ</th><th>Дефицит ЕПГУ</th><th>Покрытие ЕПГУ</th></tr></thead><tbody>
          {currentOrgRows.map((row) => <tr key={row.code}><td className={styles.name}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.gap)}</td><td className={styleFor(row.coverage)}>{percent(row.coverage)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td>{format(deficit(row.epguSlots, row.epguNorm))}</td><td className={styleFor(row.epguCoverage)}>{percent(row.epguCoverage)}</td></tr>)}
        </tbody></table></div>
      </>}
      {level === "territory" && territoryOrganizations.length === 0 && <p className={styles.empty}>По выбранным фильтрам МО не найдены.</p>}
      {level === "region" && territoryRows.length === 0 && <p className={styles.empty}>По выбранным фильтрам территорий не найдено.</p>}
    </section>

    <footer className={styles.footer}>Цель по общему нормативу и квоте ЕПГУ — 100%. «Нет данных» не заменяется нулём; неполные строки не попадают в расчёт покрытия. Источник: две отдельные Excel-выгрузки, даты указаны в карточках и списках.</footer>
  </div>;
}
