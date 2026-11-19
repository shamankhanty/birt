import catalog from "./frloz-types.json";
import report from "./semd-summary.json";

const rows = catalog.types.map((type) => ({
  ...type,
  count: report.items.find((item) => item.name === ("sourceName" in type ? type.sourceName : type.name))?.count ?? null,
}));

export default function FrlozTypesTable() {
  const registered = rows.filter((row) => row.count !== null && row.count > 0).length;
  return (
    <details className="frlozDetails" open>
      <summary>Виды СЭМД для ФРЛОЗ: {registered} из 35 зарегистрированы по выгрузке</summary>
      <p>Перечень: соглашение № 056-17-2026-099, приложение № 2, пункт 1.7. Количество: {report.source}; период {report.period}, сформирован {report.formed}. Федеральные 23/35 относятся к первому полугодию 2026 года. Регистрация сама по себе не подтверждает автоматизированное формирование.</p>
      <div className="frlozScroll"><table><thead><tr><th>№</th><th>Вид СЭМД</th><th>OID</th><th>Регистрация в РЭМД</th><th>Количество</th></tr></thead><tbody>
        {rows.map((row, index) => <tr key={row.oid}><td>{index + 1}</td><td>{row.name}</td><td>{row.oid}</td><td>{row.count === null ? "Нет данных" : row.count > 0 ? "Зарегистрирован" : "0 в этом срезе"}</td><td>{row.count === null ? "—" : row.count.toLocaleString("ru-RU")}</td></tr>)}
      </tbody></table></div>
      <small>Для OID 76/118 отчёт даёт общее число свидетельств о рождении. Остальные строки сопоставлены по точному наименованию: в своде нет столбца OID. Сверка редакций требует выгрузки с OID.</small>
    </details>
  );
}
