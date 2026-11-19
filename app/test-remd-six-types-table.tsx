"use client";

import { useState } from "react";
import data from "./test-remd-six-types.json";

type SortKey = "agreement" | "name" | "oid" | "status" | "count";
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const rows = data.types.map((type, index) => ({ ...type, agreementNumber: index + 1 }));

export default function TestRemdSixTypesTable() {
  const [sortKey, setSortKey] = useState<SortKey>("agreement");
  const [descending, setDescending] = useState(false);
  const sortedRows = [...rows].sort((a, b) => {
    if ((sortKey === "status" || sortKey === "count") && (a.count === null || b.count === null)) {
      if (a.count === null && b.count !== null) return 1;
      if (b.count === null && a.count !== null) return -1;
    }
    const status = (count: number | null) => count === null ? 2 : count >= 100 ? 0 : 1;
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
  const confirmed = rows.filter((row) => row.count !== null && row.count >= 100).length;
  return (
    <details className="frlozDetails" open>
      <summary>Шесть видов СЭМД для ВМП, специализированной помощи и СКЛ · подтверждено ≥100: {data.source ? confirmed + " из 6" : "нет данных тестовой среды"}</summary>
      <p>Перечень: соглашение № 056-17-2026-099, приложение № 2, пункт 1.8. Методика: по каждому виду не менее 100 документов, успешно зарегистрированных в тестовой среде РЭМД от ГИСЗ субъекта и прошедших ФЛК; суммарный план — не менее 600. Промышленная среда в этот расчёт не входит.</p>
      <p>Источник факта: {data.source ?? "подтверждённая выгрузка тестовой среды не представлена"}{data.period ? "; период " + data.period : ""}{data.formed ? "; сформирована " + data.formed : ""}. Федеральный срез за первое полугодие: показатель не рассчитан.</p>
      <div className="frlozScroll"><table><thead><tr>{header("agreement", "№")}{header("name", "Вид СЭМД")}{header("oid", "OID")}{header("status", "Выполнение 100")}{header("count", "Зарегистрировано")}</tr></thead><tbody>
        {sortedRows.map((row) => <tr key={row.oid}><td>{row.agreementNumber}</td><td>{row.name}</td><td>{row.oid}</td><td>{row.count === null ? "Нет данных" : row.count >= 100 ? "Выполнено" : "Менее 100"}</td><td>{row.count === null ? "—" : row.count.toLocaleString("ru-RU")}</td></tr>)}
      </tbody></table></div>
      <small>При получении новой выгрузки тестовой среды обновляются источник, период и количество по каждому OID в test-remd-six-types.json. Отсутствие выгрузки не считается нулём.</small>
    </details>
  );
}
