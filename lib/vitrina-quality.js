/**
 * Source-limited quality checks for "Витрина 2.0".
 * We only infer properties that can be observed from the two available spreadsheet exports:
 * parent, unit name and display address. No FRMO/FRMR/FNSI, doctor, cabinet or slot
 * datasets are present. A formatting finding is not a verified federal rejection.
 */
export const VITRINA_QUALITY_CATEGORIES = ["Наименования", "Адреса", "ФРМО / ФРМР", "Специальности", "Кабинеты", "Слоты"];

export const VITRINA_SOURCE_COVERAGE = {
  "Наименования": "Частично: только отображаемое название подразделения; нет реестра ФРМО",
  "Адреса": "Частично: только отображаемый адрес; нет эталона ФРМО / ГАР",
  "ФРМО / ФРМР": "Нет реестров OID МО, подразделений и идентификаторов врачей",
  "Специальности": "Нет выгрузки специальностей и справочника ФНСИ",
  "Кабинеты": "Нет выгрузки кабинетов",
  "Слоты": "Нет выгрузки статусов и параметров слотов"
};

function makeIssue(org, row, rowIndex, code, category, level, field, original, instruction, reason) {
  return {
    id: org.id + "|" + rowIndex + "|" + code,
    orgId: org.id,
    orgName: org.name,
    unitName: String(row.name ?? "").trim(),
    category,
    level,
    field,
    original,
    instruction,
    reason,
    source: "Выгрузка Витрины 2.0; сверка с ФРМО / ГАР требуется отдельно"
  };
}

/** Conservative checks: confirmed absent fields vs issues requiring source comparison. */
export function findVitrinaQualityIssues(org) {
  const issues = [];
  (org.rows ?? []).forEach((row, rowIndex) => {
    const name = String(row.name ?? "").trim();
    const address = String(row.address ?? "").trim();
    if (!name) {
      issues.push(makeIssue(org, row, rowIndex, "name-empty", "Наименования", "confirmed",
        "Наименование подразделения", "Не указано",
        "Заполнить отображаемое наименование подразделения по актуальной записи ФРМО",
        "В выгрузке отсутствует название подразделения"));
    } else if (/^(?:поликлиника|диспансерное отделение|амбулатория|кабинет)$/iu.test(name)) {
      issues.push(makeIssue(org, row, rowIndex, "name-generic", "Наименования", "review",
        "Наименование подразделения", name,
        "Сверить с ФРМО и при необходимости уточнить номер / профиль / название для пациента",
        "Общее наименование может неоднозначно обозначать подразделение; без ФРМО ошибку не подтверждаем"));
    }
    if (!address) {
      issues.push(makeIssue(org, row, rowIndex, "address-empty", "Адреса", "confirmed",
        "Адрес подразделения", "Не указан",
        "Заполнить адрес и сверить обязательные поля с ФРМО и ГАР",
        "В выгрузке отсутствует отображаемый адрес"));
    } else if (!/^\d{6}(?=,|\s|$)/u.test(address)) {
      issues.push(makeIssue(org, row, rowIndex, "address-index", "Адреса", "review",
        "Адрес подразделения", address,
        "Проверить индекс и все адресные поля по ФРМО и ГАР; исправить при подтверждении расхождения",
        "В отображаемом адресе не обнаружен индекс в начале строки; это признак для сверки, а не подтверждённое нарушение"));
    }
  });
  return issues;
}

export function buildVitrinaQuality(organizations) {
  const rows = organizations.map(org => ({ ...org, issues: findVitrinaQualityIssues(org) }));
  const issues = rows.flatMap(row => row.issues);
  const confirmed = issues.filter(issue => issue.level === "confirmed");
  const review = issues.filter(issue => issue.level === "review");
  return {
    rows,
    issues,
    confirmed,
    review,
    organizations: rows.filter(row => row.now > 0).length,
    organizationsWithIssues: rows.filter(row => row.issues.length > 0).length
  };
}

export function sortVitrinaQualityRows(rows, sortBy = "issues") {
  const result = [...rows];
  result.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "ru");
    if (sortBy === "confirmed") {
      const d = b.issues.filter(issue => issue.level === "confirmed").length - a.issues.filter(issue => issue.level === "confirmed").length;
      if (d) return d;
    }
    const d = b.issues.length - a.issues.length;
    return d || a.name.localeCompare(b.name, "ru");
  });
  return result;
}
