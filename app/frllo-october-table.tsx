import snapshot from "./frllo-october-2026.json";

export default function FrlloOctoberTable() {
  const completed = snapshot.types.reduce((sum, row) => sum + row.registered, 0);
  return (
    <section className="frlozDetails" aria-label="Пять видов сведений ФРЛЛО">
      <strong>ФРЛЛО · {completed} из {snapshot.target} видов · {completed / snapshot.target * 100}%</strong>
      <p>Кратко о методике: каждый вид засчитывается один раз, если пакет автоматически передан из ГИСЗ РТ и загружен в ФРЛЛО со статусом «Обработан» без ошибок. Доля = число таких видов / 5 × 100%; накопительно с 1 января.</p>
      <p>Федеральный срез: {snapshot.period}. Региональную техническую готовность и отправленные с ошибкой пакеты этот факт не подтверждает.</p>
      <div className="frlozScroll"><table><thead><tr><th>Вид пакета сведений</th><th>Успешно передан</th></tr></thead><tbody>
        {snapshot.types.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.registered === 1 ? "Да" : "Нет"}</td></tr>)}
      </tbody></table></div>
      <small>{snapshot.source}. При новой выгрузке обновлять этот срез отдельно от прежней истории.</small>
    </section>
  );
}
