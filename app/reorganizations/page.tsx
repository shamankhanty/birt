import rkbBranch from "../../config/rkb-spassk-branch.json";
import registry from "../../config/mo-reorganizations.json";

const statusLabel = (value: string) =>
  value === "verified" ? "Подтверждено" : "Проверяется";

export default function ReorganizationsPage() {
  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 64px", color: "#17352f", fontFamily: "Arial, sans-serif" }}>
      <a href="/birt/" style={{ color: "#167e68", fontWeight: 700, textDecoration: "none" }}>← К дашборду</a>
      <p style={{ color: "#6a817b", fontSize: 13, fontWeight: 700, letterSpacing: 1.1, marginTop: 28 }}>РЕЕСТР ИЗМЕНЕНИЙ МО</p>
      <h1 style={{ margin: "6px 0 12px", fontSize: 34 }}>Реорганизация: контроль идентификаторов</h1>
      <p style={{ maxWidth: 850, lineHeight: 1.6, color: "#556b66" }}>
        Письмо подтверждает реорганизацию, но не заменяет сверку ФРМО, ФРМР и фактических выгрузок.
        До подтверждения связок строки остаются отдельными; исторические факты и рейтинги не переписываются.
      </p>

      {registry.groups.map((group) => (
        <section key={group.id} style={{ marginTop: 28, border: "1px solid #d8e5df", borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 8px 30px rgba(19,72,58,.08)" }}>
          <div style={{ padding: "22px 24px", background: "#f1f8f5", borderBottom: "1px solid #d8e5df" }}>
            <p style={{ margin: 0, color: "#167e68", fontSize: 13, fontWeight: 700 }}>С {group.effectiveDate.split("-").reverse().join(".")}</p>
            <h2 style={{ margin: "6px 0 10px", fontSize: 25 }}>{group.name}</h2>
            <span style={{ display: "inline-block", padding: "7px 10px", borderRadius: 8, background: "#fff2d8", color: "#745620", fontWeight: 700, fontSize: 14 }}>{group.statusLabel}</span>
          </div>

          <div style={{ padding: 24 }}>
            <p style={{ marginTop: 0, lineHeight: 1.55 }}><b>Документ-основание:</b> {group.document.basis}</p>
            <p style={{ lineHeight: 1.55 }}><b>Письмо:</b> {group.document.title}</p>
            <p style={{ lineHeight: 1.55 }}><b>История:</b> {group.historicalPolicy}</p>
            <p style={{ lineHeight: 1.55 }}><b>Аналитика:</b> {group.analyticsPolicy}</p>

            <div style={{ overflowX: "auto", marginTop: 20 }}>
              <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#edf4f1", textAlign: "left" }}>
                    {["Прежняя МО", "Прежний OID", "OID правопреемника", "ФРМО", "ФРМР", "Выгрузки"].map((title) => (
                      <th key={title} style={{ padding: 12, borderBottom: "1px solid #d8e5df" }}>{title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.predecessors.map((org) => (
                    <tr key={org.oldOid}>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec", fontWeight: 700 }}>{org.name}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec", fontFamily: "monospace", fontSize: 12 }}>{org.oldOid}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec", color: "#745620" }}>{org.successorOid ?? "Не подтверждён"}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec" }}>{statusLabel(org.frmoStatus)}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec" }}>{statusLabel(org.frmrStatus)}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #e8efec" }}>{statusLabel(org.sourceStatus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: "20px 0 0", padding: 14, borderRadius: 10, background: "#fff5df", color: "#6d5727", lineHeight: 1.5 }}>
              Аналитическая группа и динамика «до/после» не формируются до подтверждения всех связок.
            </p>
          </div>
        </section>
      ))}
      <section style={{ marginTop: 28, padding: 24, background: "#fff", border: "1px solid #d8e5df", borderRadius: 18 }}>
        <p style={{ marginTop: 0, color: "#167e68", fontWeight: 700 }}>РКБ · ФИЛИАЛЬНАЯ СТРУКТУРА</p>
        <h2 style={{ fontSize: 25, margin: "0 0 12px" }}>Спасская ЦРБ — филиал РКБ</h2>
        <p style={{ lineHeight: 1.6 }}>
          Код филиала в исторических данных: <strong>{rkbBranch.branch.historicCode}</strong>.
          Действующий код юридического лица: <strong>{rkbBranch.parent.currentCode}</strong>.
          OID юридического лица: <code>{rkbBranch.parent.oid}</code>.
          Дата реорганизации по письму: 14.09.2020.
        </p>
        <p style={{ lineHeight: 1.6 }}>
          По файлу «РКБ.xlsx» определены <strong>{rkbBranch.provenance.uniqueSpOids} OID подразделений</strong>
          {" "}и <strong>{rkbBranch.provenance.uniqueBuildingIds} ID зданий</strong>.
          Период выгрузки не указан; это справочник принадлежности, а не новый факт или основание для пересчёта показателей.
        </p>
        <p style={{ padding: 14, background: "#fff5df", color: "#6d5727", borderRadius: 10, lineHeight: 1.6 }}>
          Проверка ФРМО на 30.10.2026: по коду 4001 в {rkbBranch.frmoAudit.rows} строках выявлено {rkbBranch.frmoAudit.issues} замечание(й),
          {" "}встречаются три варианта родительского OID (1094, 1132, 18650).
          До сверки ФРМО не суммировать строки филиала с итогом РКБ, не считать варианты адреса разными ЭМД
          и не присваивать Спасской ЦРБ отдельное место в рейтинге или очереди заслушивания.
        </p>
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "#167e68" }}>Показать 39 структурных подразделений и идентификаторы</summary>
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#edf4f1", textAlign: "left" }}>
                  {["Подразделение", "OID СП МО", "ID здания"].map((h) => <th key={h} style={{ padding: 10, borderBottom: "1px solid #d8e5df" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rkbBranch.subunits.map((unit) => (
                  <tr key={unit.spOid}>
                    <td style={{ padding: 9, borderBottom: "1px solid #e8efec" }}>{unit.name}</td>
                    <td style={{ padding: 9, borderBottom: "1px solid #e8efec", fontFamily: "monospace" }}>{unit.spOid}</td>
                    <td style={{ padding: 9, borderBottom: "1px solid #e8efec" }}>{unit.buildingId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </main>
  );
}