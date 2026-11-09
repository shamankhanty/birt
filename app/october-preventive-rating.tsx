"use client";

import { useState } from "react";
import october from "./rating/october-preventive-closed.json";
import november from "./rating/preventive-closed-nov08.json";
import previous from "./rating/preventive-closed-nov04.json";
import federal from "./preventive-semd-audit.json";
import { metricScore } from "../lib/september-rating.js";

const number = (value: number | null, digits = 0) =>
  value === null ? "—" : value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const buildRows = (snapshot: typeof october) => snapshot.rows.map(row => {
  const fact = row.numerator === null || !row.denominator
    ? null
    : row.numerator / row.denominator * 100;
  const score = metricScore({
    id: "preventiveClosed",
    fact,
    denominator: row.denominator,
    plan: snapshot.plan,
    status: fact === null ? "missing" : "available",
  });
  return { ...row, fact, score };
});
const octoberRows = buildRows(october);
const novemberRows = buildRows(november);
const previousRows = buildRows(previous);
const groups = [...new Set(octoberRows.map(row => row.group))];

function summarize(rows: typeof octoberRows) {
  const assessed = rows.filter(row => row.fact !== null);
  const numerator = assessed.reduce((sum, row) => sum + (row.numerator ?? 0), 0);
  const denominator = assessed.reduce((sum, row) => sum + (row.denominator ?? 0), 0);
  return { assessed, numerator, denominator, fact: denominator ? numerator / denominator * 100 : null };
}

export const closedPreventiveOperationalFact = summarize(novemberRows).fact;

export default function OctoberPreventiveRating({ indicator = false }: { indicator?: boolean }) {
  const [mode, setMode] = useState<"operational" | "monthly" | "federal">("operational");
  const operational = indicator && mode === "operational";
  const snapshot = operational ? november : october;
  const rows = operational ? novemberRows : octoberRows;
  const { assessed, numerator, denominator, fact } = summarize(rows);
  const comparableIds = new Set(previousRows.filter(row => row.fact !== null).map(row => row.key));
  const comparableCurrent = summarize(novemberRows.filter(row => comparableIds.has(row.key)));
  const currentIds = new Set(comparableCurrent.assessed.map(row => row.key));
  const comparablePrevious = summarize(previousRows.filter(row => currentIds.has(row.key)));
  const delta = comparableCurrent.fact === null || comparablePrevious.fact === null
    ? null : comparableCurrent.fact - comparablePrevious.fact;
  const [group, setGroup] = useState(groups.find(name => name === "Центральные районные больницы") ?? groups[0]);
  const [query, setQuery] = useState("");
  const visible = rows.filter(row => row.group === group && row.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.fact ?? -1) - (a.fact ?? -1) || a.name.localeCompare(b.name, "ru"));

  return <section className="septemberRating" aria-label="Регистрация СЭМД по закрытым случаям">
    {indicator && <div className="septEdition" role="group" aria-label="Режим показателя">
      <button className={mode === "operational" ? "active" : ""} onClick={() => setMode("operational")}>Оперативно</button>
      <button className={mode === "monthly" ? "active" : ""} onClick={() => setMode("monthly")}>Месяцы</button>
      <button className={mode === "federal" ? "active" : ""} onClick={() => setMode("federal")}>Федеральный показатель</button>
    </div>}
    {indicator && mode === "federal" ? <>
      <div className="pageHead ratingHead">
        <div><p className="eyebrow">ФЕДЕРАЛЬНЫЙ ПОКАЗАТЕЛЬ</p><h1>Доля СЭМД профилактического осмотра и диспансеризации</h1><p>Подтверждённый срез по РЭМД и обращениям ФОМС за {federal.summary.period122}.</p></div>
        <div className="ratingFormula"><small>Факт РТ</small><strong>{number(federal.summary.share, 2)}%</strong><span>{number(federal.summary.numerator)} / {number(federal.summary.denominator)}</span></div>
      </div>
    </> : <>
    <div className="pageHead ratingHead">
      <div>
        <p className="eyebrow">{operational ? "ОПЕРАТИВНЫЙ СРЕЗ" : "ОКТЯБРЬСКИЙ СРЕЗ"} · ВНУТРЕННЯЯ ОЦЕНКА</p>
        <h1>Регистрация СЭМД по закрытым случаям ДОГВН/ПМО</h1>
        <p>{indicator ? "Накопительный расчёт по закрытым случаям." : "Баллы по одному показателю. Итоговые места октября будут рассчитаны после закрытия остальных показателей."}</p>
      </div>
      <div className="ratingFormula"><small>Накопительный период</small><strong>{snapshot.period}</strong><span>План {snapshot.plan}%</span></div>
    </div>
    <div className="septStats">
      <article><small>МО с расчётом</small><strong>{assessed.length}</strong></article>
      <article><small>Выбрано СЭМД</small><strong>{number(numerator)}</strong></article>
      <article><small>Закрыто случаев</small><strong>{number(denominator)}</strong></article>
      <article><small>Факт по этим МО</small><strong>{fact === null ? "Нет данных" : `${number(fact, 2)}%`}</strong></article>
    </div>
    {indicator && <p className="sourceDataNote">{operational
      ? <>Сопоставимые МО на 04.11 → 08.11 ({comparableCurrent.assessed.length}): {number(comparablePrevious.fact, 2)}% → {number(comparableCurrent.fact, 2)}%. Изменение {delta !== null && delta > 0 ? "+" : ""}{number(delta, 2)} п.п.</>
      : "Последний закрытый срез по этой формуле — 31.10. Сопоставимой выгрузки на 30.09 и для более ранних месяцев в полученном комплекте нет."}</p>}
    <details className="septMethod">
      <summary>Формула и источник</summary>
      <div className="septMethodBody">
        <p>Источник — отчёт «Закрытые случаи ДОГВН/ПМО и СЭМД 122 и 228», сформирован {operational ? "08.11.2026" : "09.11.2026"}. Факт по МО = MAX(122; 228) в статусе «Зарег» ÷ (выполнено ДОГВН + выполнено ПМО) × 100%. Для детских МО, где ДОГВН неприменима, знаменатель равен ПМО.</p>
        <p>Балл = факт ÷ {snapshot.plan}% × 100, максимум 100 баллов. Федеральный показатель со знаменателем ФОМС ведётся отдельно. Месячная динамика доступна при наличии сопоставимой выгрузки за предыдущий месяц.</p>
      </div>
    </details>
    <div className="septTools">
      <label>Тип МО <select value={group} onChange={event => setGroup(event.target.value)}>
        {groups.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <input aria-label="Найти МО в срезе" placeholder="Найти МО" value={query} onChange={event => setQuery(event.target.value)}/>
      <span className="septVisibleCount">{visible.length} МО</span>
    </div>
    <div className="tableWrap">
      <table className="matrix">
        <thead><tr><th>Медицинская организация</th><th>СЭМД 122</th><th>СЭМД 228</th><th>Случаи ДОГВН / ПМО</th><th>СЭМД / случаи</th><th>Факт</th><th>Баллы</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.key}>
          <th scope="row">{row.name}</th>
          <td>{number(row.semd122)}</td><td>{number(row.semd228)}</td>
          <td>{row.adultNotApplicable ? "н/п" : number(row.dogvn)} / {number(row.pmo)}</td>
          <td>{number(row.numerator)} / {number(row.denominator)}</td>
          <td>{row.fact === null ? "Нет данных" : `${number(row.fact, 2)}%`}</td><td>{number(row.score, 2)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    </>}
  </section>;
}
