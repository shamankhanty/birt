"use client";

import { useMemo, useState } from "react";
import raw from "./frmr-reconciliation-data.json";
import styles from "./frmr-reconciliation.module.css";

type SpecialityGroup = [string, number];
type PositionRecord = [
  string, string, number | null, number | null,
  number, number, number, number | null, SpecialityGroup[]
];
type Org = {
  id: string;
  name: string;
  feb: number | null;
  previous: number | null;
  current: number;
  stage1: number;
  stage2: number;
  positions: number | null;
  specialties: SpecialityGroup[];
};
const orgs: Org[] = (raw.rows as unknown as PositionRecord[]).map(
  ([id, name, feb, previous, current, stage1, stage2, positions, specialties]) =>
    ({ id, name, feb, previous, current, stage1, stage2, positions, specialties }),
);
const topSpecialties = raw.topSpecialties as unknown as SpecialityGroup[];
const number = (n: number | null | undefined) =>
  typeof n === "number" ? new Intl.NumberFormat("ru-RU").format(n) : "—";
const signed = (n: number | null) =>
  n === null ? "—" : (n > 0 ? "+" : "") + number(n);
const change = (row: Org) =>
  row.previous === null ? null : row.current - row.previous;
const sortedOrgs = [...orgs].sort((a, b) => a.name.localeCompare(b.name, "ru"));

export default function FrmrReconciliation() {
  const [view, setView] = useState<"minister" | "organization">("minister");
  const [filter, setFilter] = useState<"all" | "worse" | "better" | "missing" | "zero">("all");
  const [sort, setSort] = useState<"count" | "worsening" | "improving" | "name">("count");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("1094");
  const [copied, setCopied] = useState(false);

  const selected = orgs.find((row) => row.id === selectedId) ?? orgs[0];
  const previousTotal = orgs.reduce((sum, row) => sum + (row.previous ?? 0), 0);
  const currentTotal = orgs.reduce((sum, row) => sum + row.current, 0);
  const febTotal = orgs.reduce((sum, row) => sum + (row.feb ?? 0), 0);
  const stage1Total = orgs.reduce((sum, row) => sum + row.stage1, 0);
  const stage2Total = orgs.reduce((sum, row) => sum + row.stage2, 0);
  const affected = orgs.filter((row) => row.current > 0).length;
  const improvedCount = orgs.filter((row) => change(row) !== null && change(row)! < 0).length;
  const worsenedCount = orgs.filter((row) => change(row) !== null && change(row)! > 0).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru");
    return orgs
      .filter((row) => row.name.toLocaleLowerCase("ru").includes(q) || row.id.includes(q))
      .filter((row) =>
        filter === "all" ? true :
        filter === "worse" ? change(row) !== null && change(row)! > 0 :
        filter === "better" ? change(row) !== null && change(row)! < 0 :
        filter === "zero" ? row.current === 0 :
        row.current > 0,
      )
      .sort((a, b) =>
        sort === "worsening" ? ((change(b) ?? -Infinity) - (change(a) ?? -Infinity)) || b.current - a.current :
        sort === "improving" ? ((change(a) ?? Infinity) - (change(b) ?? Infinity)) || b.current - a.current :
        sort === "name" ? a.name.localeCompare(b.name, "ru") :
        b.current - a.current || a.name.localeCompare(b.name, "ru"),
      );
  }, [filter, search, sort]);

  const taskText = [
    "Контроль расхождений ФРМР ↔ ГИС на 22.10.2026",
    "Медицинская организация: " + selected.name,
    "OID МО: 1.2.643.5.1.13.13.12.2.16." + selected.id,
    "Расхождения: " + selected.current + " должностных записей (16.10: " + (selected.previous ?? "нет данных") + "; изменение " + signed(change(selected)) + ").",
    "Нет соответствующей должности в ГИС на уровне МО: " + selected.stage1 + ".",
    "Должность не соответствует структурному подразделению: " + selected.stage2 + ".",
    "Поручение: провести по каждой записи проверку ФРМР и ГИС; подтвердить трудоустройство, актуальную должность и структурное подразделение; устранить причины; перепроверить результат следующей выгрузкой.",
    "Отдельно проверить, влияет ли ошибка на расписание и публикацию слотов ЕПГУ. По одной этой сверке влияние на запись не подтверждено.",
    "Указать ответственного исполнителя, срок и подтверждение исправления.",
    "В публичной версии персональные данные и построчные идентификаторы сотрудников не размещены.",
  ].join("\n");

  const copyTask = async () => {
    try {
      await navigator.clipboard.writeText(taskText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const trendBars = (values: [string, number][]) => (
    <div className={styles.trend}>
      {values.map(([label, value]) => (
        <div className={styles.trendRow} key={label}>
          <span>{label}</span>
          <div className={styles.track} aria-label={label + ": " + number(value)}>
            <div className={styles.bar} style={{ width: (value / Math.max(1, ...values.map(([, v]) => v)) * 100) + "%" }} />
          </div>
          <b>{number(value)}</b>
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.root} data-testid="frmr-reconciliation">
      <section className={styles.hero}>
        <span className={styles.tag}>● В разработке · Инцидент № 38</span>
        <h1>ФРМР ↔ ГИС: достоверность должностей врачей</h1>
        <p>Единый контроль расхождений между федеральным регистром и региональной ГИС. Для руководителя — масштаб, динамика и МО с ухудшением. Для МО — структура проблем и конкретные действия.</p>
        <div className={styles.heroBottom}>
          <span className={styles.eyebrow}>Срез 22.10.2026 · предыдущий 16.10.2026</span>
          <span className={styles.heroNote}>Единица учёта — должностная запись, а не уникальный врач. Влияние на запись пациентов пока не подтверждено.</span>
        </div>
      </section>

      <div className={styles.tabs} role="group" aria-label="Представление раздела">
        <button className={[styles.tab, view === "minister" ? styles.tabActive : ""].join(" ")} onClick={() => setView("minister")} aria-pressed={view === "minister"}>Обзор для министра</button>
        <button className={[styles.tab, view === "organization" ? styles.tabActive : ""].join(" ")} onClick={() => setView("organization")} aria-pressed={view === "organization"}>Карточка МО и действия</button>
      </div>

      {view === "minister" ? (
        <>
          <div className={styles.stats}>
            <article className={styles.stat}><span className={styles.statLabel}>Расхождения на 22.10</span><strong className={styles.negative}>{number(currentTotal)}</strong><small>должностных записей · снижение на {number(previousTotal - currentTotal)} к 16.10</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>МО с расхождениями</span><strong>{affected} <span className={styles.muted}>/ {orgs.length}</span></strong><small>в проверяемом перечне</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>Улучшили / ухудшили</span><strong><span className={styles.positive}>{improvedCount}</span> / <span className={styles.negative}>{worsenedCount}</span></strong><small>изменение числа записей к 16.10</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>Снижение с февраля</span><strong className={styles.positive}>{number(febTotal - currentTotal)}</strong><small>{number(febTotal)} → {number(currentTotal)} · −{((febTotal - currentTotal) / febTotal * 100).toFixed(1).replace(".", ",")}%</small></article>
          </div>
          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><div><h2>Динамика по республике</h2><span className={styles.muted}>Исторические точки только на датах, присутствующих в файле</span></div><span className={styles.pill}>−{number(previousTotal - currentTotal)} за 6 дней</span></div>
              {trendBars([["01.02", febTotal], ["16.10", previousTotal], ["22.10", currentTotal]])}
              <div className={styles.legend}><span>От 16.10: <b>{signed(currentTotal - previousTotal)}</b></span><span>От 01.02: <b>{signed(currentTotal - febTotal)}</b></span></div>
            </section>
            <section className={styles.panel}>
              <h2>Причины расхождений</h2>
              <div className={styles.muted}>Две взаимоисключающие группы из методики исходной сверки</div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Должность отсутствует на уровне МО</span><strong>{number(stage1Total)}</strong></div><div className={styles.reasonTrack}><div className={[styles.reasonFill,styles.one].join(" ")} style={{width:(stage1Total/currentTotal*100)+"%"}} /></div></div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Не совпадает структурное подразделение</span><strong>{number(stage2Total)}</strong></div><div className={styles.reasonTrack}><div className={[styles.reasonFill,styles.two].join(" ")} style={{width:(stage2Total/currentTotal*100)+"%"}} /></div></div>
              <p className={styles.muted}>Обе категории требуют проверки фактического трудоустройства, OID МО, подразделения и должности; автоматическое изменение ФРМР недопустимо.</p>
            </section>
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}><div><h2>Мониторинг медицинских организаций</h2><span className={styles.muted}>Нажмите на название МО, чтобы открыть её карточку. Сортировка по объёму — не рейтинг качества работы.</span></div><span className={styles.pill}>{number(filtered.length)} МО</span></div>
            <div className={styles.filters}>
              <input className={styles.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск МО или OID…" aria-label="Поиск МО"/>
              <select className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Фильтр по изменению">
                <option value="all">Все МО</option><option value="worse">Ухудшение</option><option value="better">Улучшение</option><option value="missing">Есть расхождения</option><option value="zero">Без расхождений</option>
              </select>
              <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка МО">
                <option value="count">По числу расхождений ↓</option><option value="worsening">По ухудшению ↓</option><option value="improving">По улучшению ↓</option><option value="name">По названию</option>
              </select>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Медицинская организация</th><th>16.10</th><th>22.10</th><th>Δ</th><th>Нет в МО</th><th>Не в СП</th></tr></thead>
                <tbody>{filtered.map((row) => {
                  const delta = change(row);
                  return <tr key={row.id}>
                    <td><button type="button" className={styles.clickName} onClick={() => {setSelectedId(row.id);setCopied(false);setView("organization");}}>{row.name}</button></td>
                    <td>{number(row.previous)}</td><td><b>{number(row.current)}</b></td>
                    <td className={[styles.delta,delta === null || delta === 0 ? styles.stable : delta > 0 ? styles.bad : styles.good].join(" ")}>{signed(delta)}</td>
                    <td>{number(row.stage1)}</td><td>{number(row.stage2)}</td>
                  </tr>;
                })}</tbody>
              </table>
              {filtered.length === 0 && <p className={styles.muted}>По выбранным фильтрам МО не найдены.</p>}
            </div>
          </section>
          <section className={styles.grid}>
            <div className={styles.panel}>
              <h2>Должности с наибольшим числом расхождений</h2>
              <p className={styles.muted}>Показатели относятся к наименованиям должностей ФРМР, не к квалификационным сертификатам.</p>
              {topSpecialties.slice(0,8).map(([name,count]) => <div className={styles.spec} key={name}><span>{name}</span><strong>{number(count)}</strong></div>)}
            </div>
            <div className={styles.panel}>
              <h2>Что должен видеть министр</h2>
              <div className={styles.action}><b className={styles.actionNum}>1</b><div><b>Изменение с прошлого среза</b><span>В каких МО проблема сокращается, сохраняется или усиливается.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>2</b><div><b>Системные причины</b><span>Разделение отсутствующих должностей и несоответствий подразделений.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>3</b><div><b>Влияние на пациента</b><span>Пока не рассчитано. Следующий этап — связать кадровые записи с расписаниями, опубликованными слотами и ошибками записи.</span></div></div>
              <div className={styles.warning}>Не следует сравнивать разные типы МО только по абсолютному числу расхождений: численность кадров и функции организаций различаются.</div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className={styles.panel}>
            <div className={styles.moHeader}>
              <div><h2>Карточка медицинской организации</h2><p className={styles.muted}>Выберите свою МО. Данные обезличены; подробный реестр сотрудников должен находиться в защищённом контуре ГИС.</p></div>
              <select className={[styles.select,styles.moSelect].join(" ")} value={selected.id} onChange={(e)=>{setSelectedId(e.target.value);setCopied(false);}} aria-label="Выбор медицинской организации">
                {sortedOrgs.map((row)=><option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <span className={styles.muted}>OID: 1.2.643.5.1.13.13.12.2.16.{selected.id}</span>
            </div>
            <div className={styles.miniStats}>
              <article><small>Расхождения на 22.10</small><b className={selected.current ? styles.negative : styles.positive}>{number(selected.current)}</b></article>
              <article><small>Изменение к 16.10</small><b className={change(selected)! > 0 ? styles.negative : styles.positive}>{signed(change(selected))}</b></article>
              <article><small>Отсутствует на уровне МО</small><b>{number(selected.stage1)}</b></article>
              <article><small>Не совпадает подразделение</small><b>{number(selected.stage2)}</b></article>
            </div>
          </section>
          <div className={styles.grid}>
            <section className={styles.panel}>
              <h2>Динамика выбранной МО</h2>
              {trendBars([["01.02",selected.feb??0],["16.10",selected.previous??0],["22.10",selected.current]])}
              <p className={styles.muted}>Даты — контрольные точки из исходного файла. Сравнение не означает автоматически улучшение доступности записи.</p>
              <h2 style={{marginTop:24}}>Распределение по должностям</h2>
              <p className={styles.muted}>Для защиты персональных сведений показываются только группы с тремя и более записями. Мелкие группы не раскрываются поимённо.</p>
              {selected.specialties.length ? selected.specialties.map(([name,count])=><div className={styles.spec} key={name}><span>{name.replace(/^- /,"")}</span><strong>{count}</strong></div>) : <p className={styles.muted}>Групп из трёх и более однотипных расхождений не выявлено.</p>}
              {selected.current > selected.specialties.reduce((sum,[,n])=>sum+n,0) && <p className={styles.muted}>Остальные записи: {selected.current-selected.specialties.reduce((sum,[,n])=>sum+n,0)} — без раскрытия малочисленных категорий.</p>}
            </section>
            <section className={styles.panel}>
              <h2>Что нужно сделать МО</h2>
              <div className={styles.action}><b className={styles.actionNum}>1</b><div><b>Проверить отсутствующие должности ({number(selected.stage1)})</b><span>Сверить кадровый приказ и фактическое трудоустройство, OID МО и запись в ГИС. Не создавать дубли автоматически.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>2</b><div><b>Уточнить подразделения ({number(selected.stage2)})</b><span>Сопоставить подразделение из ФРМО, филиал, должность и фактическое место работы.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>3</b><div><b>Проверить запись пациентов</b><span>Выяснить, относится ли должность к амбулаторному приёму, есть ли расписание и опубликованы ли слоты на ЕПГУ.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>4</b><div><b>Подтвердить исправление</b><span>Указать ответственного, срок, первопричину и результат повторной сверки.</span></div></div>
              <div className={styles.warning}>Приоритетность корректировки не равна числу расхождений. Приоритет для пациента устанавливается только после проверки влияния на расписание и возможность записи.</div>
              <div className={styles.linkrow}>
                <button className={styles.button} type="button" onClick={copyTask}>{copied ? "Поручение скопировано" : "Скопировать поручение для МО"}</button>
                <button className={[styles.button,styles.ghost].join(" ")} type="button" onClick={()=>setView("minister")}>К общей сводке</button>
              </div>
            </section>
          </div>
        </>
      )}
      <div className={styles.footnote}>
        Источник: {raw.source}. Проверено 7 279 должностных записей, мониторинг 137 МО.
        Сверка выполнена только в направлении ФРМР → ГИС. Обратная сверка и причинная связь с инцидентом № 38 пока не подтверждены.
        Раздел экспериментальный: текущие результаты не следует использовать для санкций или формального рейтинга МО.
      </div>
    </div>
  );
}
