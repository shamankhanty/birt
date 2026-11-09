"use client";

import { useState } from "react";
import snapshot from "./rating/october-preventive-closed.json";
import { metricScore } from "../lib/september-rating.js";

const number = (value: number | null, digits = 0) =>
  value === null ? "—" : value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const rows = snapshot.rows.map(row => {
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
const groups = [...new Set(rows.map(row => row.group))];
const assessed = rows.filter(row => row.fact !== null);
const numerator = assessed.reduce((sum, row) => sum + (row.numerator ?? 0), 0);
const denominator = assessed.reduce((sum, row) => sum + (row.denominator ?? 0), 0);

export default function OctoberPreventiveRating() {
  const [group, setGroup] = useState(groups.find(name => name === "Центральные районные больницы") ?? groups[0]);
  const [query, setQuery] = useState("");
  const visible = rows.filter(row => row.group === group && row.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.fact ?? -1) - (a.fact ?? -1) || a.name.localeCompare(b.name, "ru"));

  return <section className="septemberRating" aria-label="Октябрьский срез регистрации СЭМД по закрытым случаям">
    <div className="pageHead ratingHead">
      <div>
        <p className="eyebrow">ОКТЯБРЬСКИЙ СРЕЗ · ВНУТРЕННЯЯ ОЦЕНКА</p>
        <h1>Регистрация СЭМД по закрытым случаям ДОГВН/ПМО</h1>
        <p>Баллы по одному показателю. Итоговые места октября будут рассчитаны после закрытия остальных показателей.</p>
      </div>
      <div className="ratingFormula"><small>Накопительный период</small><strong>{snapshot.period}</strong><span>План {snapshot.plan}%</span></div>
    </div>
    <div className="septStats">
      <article><small>МО с расчётом</small><strong>{assessed.length}</strong></article>
      <article><small>Выбрано СЭМД</small><strong>{number(numerator)}</strong></article>
      <article><small>Закрыто случаев</small><strong>{number(denominator)}</strong></article>
      <article><small>Факт по этим МО</small><strong>{number(numerator / denominator * 100, 2)}%</strong></article>
    </div>
    <details className="septMethod">
      <summary>Формула и источник</summary>
      <div className="septMethodBody">
        <p>Источник — отчёт «Закрытые случаи ДОГВН/ПМО и СЭМД 122 и 228», сформирован 09.11.2026. Факт по МО = MAX(122; 228) в статусе «Зарег» ÷ (выполнено ДОГВН + выполнено ПМО) × 100%. Для детских МО, где ДОГВН неприменима, знаменатель равен ПМО.</p>
        <p>Балл = факт ÷ {snapshot.plan}% × 100, максимум 100 баллов. Федеральный показатель со знаменателем ФОМС ведётся отдельно. Динамика доступна после пересчёта предыдущего периода по той же формуле.</p>
      </div>
    </details>
    <div className="septTools">
      <label>Тип МО <select value={group} onChange={event => setGroup(event.target.value)}>
        {groups.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <input aria-label="Найти МО в октябрьском срезе" placeholder="Найти МО" value={query} onChange={event => setQuery(event.target.value)}/>
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
  </section>;
}
