"use client";

import { useState } from "react";
import catalog from "./frloz-types.json";
import report from "./semd-summary.json";

const rows = catalog.types.map((type, index) => ({
  agreementNumber: index + 1,
  ...type,
  count: report.items.find((item) => item.name === ("sourceName" in type ? type.sourceName : type.name))?.count ?? null,
}));

type SortKey = "agreement" | "name" | "oid" | "status" | "count";
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export default function FrlozTypesTable() {
  const [sortKey, setSortKey] = useState<SortKey>("agreement");
  const [descending, setDescending] = useState(false);
  const sortedRows = [...rows].sort((a, b) => {
    if ((sortKey === "count" || sortKey === "status") && (a.count === null || b.count === null)) {
      if (a.count === null && b.count !== null) return 1;
      if (b.count === null && a.count !== null) return -1;
    }
    const status = (count: number | null) => count === null ? 2 : count === 0 ? 1 : 0;
    const result = sortKey === "agreement" ? a.agreementNumber - b.agreementNumber
      : sortKey === "name" ? collator.compare(a.name, b.name)
      : sortKey === "oid" ? collator.compare(a.oid, b.oid)
      : sortKey === "status" ? status(a.count) - status(b.count)
      : (a.count ?? 0) - (b.count ?? 0);
    return (descending ? -result : result) || a.agreementNumber - b.agreementNumber;
  });
  const sort = (key: SortKey) => {
    if (key === sortKey) setDescending(!descending);
    else { setSortKey(key); setDescending(key === "count"); }
  };
  const header = (key: SortKey, label: string) => <th aria-sort={sortKey === key ? (descending ? "descending" : "ascending") : "none"}><button type="button" className="frlozSort" onClick={() => sort(key)}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? " ↓" : " ↑") : " ↕"}</span></button></th>;
  const registered = rows.filter((row) => row.count !== null && row.count > 0).length;
  return (
    <details className="frlozDetails" open>
      <summary>Виды СЭМД для ФРЛОЗ: {registered} из 35 зарегистрированы по выгрузке</summary>
      <p>Перечень: соглашение № 056-17-2026-099, приложение № 2, пункт 1.7. Количество: {report.source}; период {report.period}, сформирован {report.formed}. Федеральные 23/35 относятся к первому полугодию 2026 года. Регистрация сама по себе не подтверждает автоматизированное формирование.</p>
      <div className="frlozScroll"><table><thead><tr>{header("agreement", "№")}{header("name", "Вид СЭМД")}{header("oid", "OID")}{header("status", "Регистрация в РЭМД")}{header("count", "Количество")}</tr></thead><tbody>
        {sortedRows.map((row) => <tr key={row.oid}><td>{row.agreementNumber}</td><td>{row.name}</td><td>{row.oid}</td><td>{row.count === null ? "Нет данных" : row.count > 0 ? "Зарегистрирован" : "0 в этом срезе"}</td><td>{row.count === null ? "—" : row.count.toLocaleString("ru-RU")}</td></tr>)}
      </tbody></table></div>
      <small>Для OID 76/118 отчёт даёт общее число свидетельств о рождении. Остальные строки сопоставлены по точному наименованию: в своде нет столбца OID. Сверка редакций требует выгрузки с OID.</small>
    </details>
  );
}
