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

const DATA: Record<Scope, Dataset> = {
  city: cityRaw as Dataset,
  districts: districtRaw as Dataset,
};
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const gap = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
const safeSum = (values: SlotValue[]) => values.some((v) => v === null || v === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const styleFor = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.warn;

function aggregate(dataset: Dataset, code: string) {
  const values = dataset.orgs.map((org) => org.specialties.find((item) => item.code === code)).filter((item): item is Specialty => Boolean(item));
  const applicable = values.filter((item) => item.norm !== null && item.norm > 0);
  const missingNorm = values.filter((item) => item.norm === null).length;
  const missingSlots = applicable.filter((item) => item.slots === null).length;
  const missingEpgu = applicable.filter((item) => item.epguNorm === null || item.epguSlots === null).length;
  const norm = safeSum(applicable.map((item) => item.norm));
  const slots = safeSum(applicable.map((item) => item.slots));
  const epguNorm = safeSum(applicable.map((item) => item.epguNorm));
  const epguSlots = safeSum(applicable.map((item) => item.epguSlots));
  const coverage = missingNorm || missingSlots ? null : ratio(slots, norm);
  const epguCoverage = missingNorm || missingEpgu ? null : ratio(epguSlots, epguNorm);
  return {
    code,
    name: dataset.specialties.find((item) => item.code === code)?.name ?? code,
    applicable: applicable.length,
    norm,
    slots,
    gap: missingNorm || missingSlots ? null : gap(slots, norm),
    coverage,
    epguNorm,
    epguSlots,
    epguCoverage,
    missing: missingNorm + missingSlots,
    missingEpgu,
  };
}

export default function Incident38Dashboard() {
  const [scope, setScope] = useState<Scope>("city");
  const [territory, setTerritory] = useState("all");
  const [selectedOid, setSelectedOid] = useState("");
  const [search, setSearch] = useState("");
  const dataset = DATA[scope];

  const rows = useMemo(() => dataset.specialties.map((item) => aggregate(dataset, item.code)), [dataset]);
  const complete = rows.every((item) => item.missing === 0);
  const totalNorm = safeSum(rows.map((item) => item.norm));
  const totalSlots = safeSum(rows.map((item) => item.slots));
  const totalGap = complete ? safeSum(rows.map((item) => item.gap)) : null;
  const epguComplete = rows.every((item) => item.missing === 0 && item.missingEpgu === 0);
  const totalEpguNorm = safeSum(rows.map((item) => item.epguNorm));
  const totalEpguSlots = safeSum(rows.map((item) => item.epguSlots));
  const totalEpguGap = epguComplete ? safeSum(rows.map((item) => gap(item.epguSlots, item.epguNorm))) : null;
  const overallCoverage = complete ? ratio(totalSlots, totalNorm) : null;

  const territories = useMemo(() => [...new Set(dataset.orgs.map((org) => org.city))].sort((a, b) => a.localeCompare(b, "ru")), [dataset]);
  const filteredOrganizations = useMemo(() => dataset.orgs
    .filter((org) => territory === "all" || org.city === territory)
    .filter((org) => `${org.name} ${org.fullName} ${org.code}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")))
    .sort((a, b) => a.name.localeCompare(b.name, "ru")), [dataset, territory, search]);
  const selectedOrganization = filteredOrganizations.find((org) => org.oid === selectedOid) ?? filteredOrganizations[0] ?? null;
  const organizationRows = selectedOrganization?.specialties
    .map((item) => ({ ...item, coverage: ratio(item.slots, item.norm), epguCoverage: ratio(item.epguSlots, item.epguNorm), deficit: gap(item.slots, item.norm) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)) ?? [];
  const orgGap = selectedOrganization ? safeSum(selectedOrganization.specialties.filter((item) => item.norm !== null && item.norm > 0).map((item) => gap(item.slots, item.norm))) : null;
  const orgEpguGap = selectedOrganization ? safeSum(selectedOrganization.specialties.filter((item) => item.norm !== null && item.norm > 0).map((item) => gap(item.epguSlots, item.epguNorm))) : null;
  const incompleteCount = rows.reduce((sum, item) => sum + item.missing, 0);

  const switchScope = (next: Scope) => {
    setScope(next);
    setTerritory("all");
    setSelectedOid("");
    setSearch("");
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>ОТДЕЛЬНЫЙ РАЗДЕЛ ДАШБОРДА · И38</p>
          <h1>Доступность записи к врачу</h1>
          <p className={styles.subtitle}>Свободные слоты по 14 обязательным специальностям и нормативам на ближайшие {dataset.forwardDays} дней</p>
        </div>
        <div className={styles.dateBox}><span>Срез выгрузки</span><strong>{dataset.reportDate}</strong><small>Данные ФРМР: {dataset.frmoDate}</small></div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label="Набор данных">
          <button type="button" className={scope === "city" ? styles.active : ""} onClick={() => switchScope("city")}>Города</button>
          <button type="button" className={scope === "districts" ? styles.active : ""} onClick={() => switchScope("districts")}>Районы</button>
        </div>
        <span className={styles.source}>{dataset.source}</span>
      </div>
      <p className={styles.cutNotice}>Городской и районный наборы получены в разные даты. Срезы показываются отдельно и напрямую по датам не сравниваются.</p>

      <section className={styles.cards} aria-label="Сводные показатели">
        <article className={styles.card}><span>МО в источнике</span><strong>{numberFormat.format(dataset.orgCount)}</strong><small>отдельные МО без филиалов</small></article>
        <article className={styles.card}><span>Покрытие общего норматива</span><strong className={styleFor(overallCoverage)}>{percent(overallCoverage)}</strong><small>{format(totalSlots)} слотов из {format(totalNorm)} нормативных</small></article>
        <article className={styles.card}><span>Дефицит общих слотов</span><strong>{format(totalGap)}</strong><small>{complete ? "сумма положительных отклонений" : "не рассчитан при неполных данных"}</small></article>
        <article className={styles.card}><span>Дефицит квоты ЕПГУ</span><strong>{format(totalEpguGap)}</strong><small>{format(totalEpguSlots)} из {format(totalEpguNorm)} слотов ЕПГУ</small></article>
      </section>

      {incompleteCount > 0 && <p className={styles.warning}>В данных есть пропуски по специальностям ({incompleteCount} значений). Они не заменены нулями; агрегаты с пропусками не рассчитываются.</p>}

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Обеспеченность по специальностям</h2><p>Региональный агрегат = сумма слотов ÷ сумма норматива; ЕПГУ рассчитывается отдельно</p></div><span className={styles.legend}>100% — норматив закрыт</span></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th>МО с нормативом</th><th>Норматив</th><th>Слоты</th><th>Дефицит</th><th>Покрытие</th><th>Покрытие ЕПГУ</th></tr></thead><tbody>
          {rows.map((item) => <tr key={item.code}><td className={styles.name}>{item.name}</td><td>{numberFormat.format(item.applicable)}</td><td>{format(item.norm)}</td><td>{format(item.slots)}</td><td>{format(item.gap)}</td><td className={styleFor(item.coverage)}>{percent(item.coverage)}</td><td className={styleFor(item.epguCoverage)}>{percent(item.epguCoverage)}</td></tr>)}
        </tbody></table></div>
        <p className={styles.method}>Дефицит = max(0, норматив − слоты). Норматив 0 означает неприменимость. Пустое значение остаётся «нет данных». В источнике показаны свободные слоты, а не количество совершённых записей.</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>Карточка медицинской организации</h2><p>Сначала МО с наименьшим покрытием норматива; можно выбрать территорию и организацию</p></div></div>
        <div className={styles.filters}>
          <label>Территория<select value={territory} onChange={(event) => { setTerritory(event.target.value); setSelectedOid(""); }}><option value="all">Все территории</option>{territories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Поиск МО<input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedOid(""); }} placeholder="Название или код МО" /></label>
          <label className={styles.orgSelect}>Медицинская организация<select value={selectedOrganization?.oid ?? ""} onChange={(event) => setSelectedOid(event.target.value)}>{filteredOrganizations.map((org) => <option key={org.oid} value={org.oid}>{org.name} · {org.city}</option>)}</select></label>
        </div>
        {selectedOrganization ? <>
          <div className={styles.orgHeading}><div><strong>{selectedOrganization.name}</strong><span>{selectedOrganization.city} · код МО {selectedOrganization.code}</span></div><span className={styles.oid}>OID {selectedOrganization.oid}</span></div>
          <div className={styles.orgCards}><article><span>Дефицит общих слотов</span><strong>{format(orgGap)}</strong></article><article><span>Дефицит слотов ЕПГУ</span><strong>{format(orgEpguGap)}</strong></article><article><span>Отчётный срез</span><strong>{dataset.reportDate}</strong></article></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив</th><th>Слоты</th><th>Дефицит</th><th>Покрытие</th><th>Норма ЕПГУ</th><th>Слоты ЕПГУ</th><th>Покрытие ЕПГУ</th></tr></thead><tbody>
            {organizationRows.map((item) => <tr key={item.code}><td className={styles.name}>{item.name}</td><td>{format(item.norm)}</td><td>{format(item.slots)}</td><td>{format(item.deficit)}</td><td className={styleFor(item.coverage)}>{percent(item.coverage)}</td><td>{format(item.epguNorm)}</td><td>{format(item.epguSlots)}</td><td className={styleFor(item.epguCoverage)}>{percent(item.epguCoverage)}</td></tr>)}
          </tbody></table></div>
        </> : <p className={styles.empty}>По выбранным условиям МО не найдены.</p>}
      </section>

      <footer className={styles.footer}>Источник: {dataset.source}. Окно слотов: 14 дней. Городской срез: 10.11.2026; районный: 12.11.2026. Слоты и квота ЕПГУ — самостоятельные показатели.</footer>
    </div>
  );
}
