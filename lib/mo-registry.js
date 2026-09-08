/**
 * Single runtime adapter for medical-organization names and aliases.
 *
 * IMPORTANT: this module does not alter app/mo-registry.json. It only provides
 * deterministic indexing and name normalization around the approved registry.
 * Fuzzy matching is intentionally not used.
 */

const MO_ACRONYMS = new Set([
  "АДРБ", "АССМП", "АЦОЗ", "БСМП", "ГВВ", "ГДБ", "ГДП", "ГКБ", "ДГБ",
  "ДГКБ", "ДГП", "ДРКБ", "ДСП", "ДЦМР", "КДМЦ", "КМУ", "КФУ", "КЭД",
  "МКДЦ", "НДРБ", "НЦРМБ", "РКБ", "РКИБ", "РККВД", "РКНД", "РКОБ",
  "РКОД", "РКПБ", "РКПД", "РСП", "РЦОЗ", "РЦПБ", "СПИД", "ССМП", "ЦГКБ",
  "ЦРБ", "ЦРМБ", "ФГАОУВО",
]);

export const SPASSK_CRB_REPORT_METRICS = new Set([
  "egpu",
  "egpu2days",
  "semd228",
  "hospital",
  "ambulatoryCase",
  "shortInput",
  "shortInputAmb",
  "shortInputHosp",
  "tmkMaxCount",
  "elnMaxCount",
]);

export const SPASSK_CRB_ORGANIZATION = Object.freeze({
  name: "Спасская ЦРБ",
  shortName: "Спасская ЦРБ",
  oid: "context:spassk-crb",
  type: "Центральные районные больницы",
  district: "Спасский",
  applicable: [...SPASSK_CRB_REPORT_METRICS],
  aliases: ["Спасская ЦРБ"],
});

function cleanLegalName(name) {
  return String(name ?? "")
    .replace(
      /^(?:Филиал\s+)?(?:ГАУЗ|ГБУЗ|ГБУ|ФГБУ|ФГАОУВО|ФГАОУ ВО|АО|ООО)(?:\s+РТ)?\s*/iu,
      "",
    )
    .replace(/[\"]/g, "")
    .trim();
}

function normalizeMoCase(value) {
  return value
    .replace(/[А-ЯЁ]{3,}/gu, (word) =>
      MO_ACRONYMS.has(word)
        ? word
        : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .replace(
      /\s+(И|С|В|ПО|ДЛЯ|ИМ|ПРОФ)\.?\s+/gu,
      (part) => ` ${part.trim().toLowerCase()} `,
    );
}

export function cleanMoName(name) {
  const shortened = cleanLegalName(name)
    .replace(/Центральная районная больница/giu, "ЦРБ")
    .replace(/Центральная районная многопрофильная больница/giu, "ЦРМБ")
    .replace(
      /Детская городская клиническая больница|Городская детская клиническая больница/giu,
      "ДГКБ",
    )
    .replace(/Детская\s+ГП/giu, "ДГП")
    .replace(
      /Детская городская поликлиника|Городская детская поликлиника/giu,
      "ДГП",
    )
    .replace(/Детская городская больница|Городская детская больница/giu, "ДГБ")
    .replace(/Городская клиническая больница/giu, "ГКБ")
    .replace(/Городская поликлиника/giu, "ГП")
    .replace(/Городская больница/giu, "ГБ")
    .replace(/Больница скорой медицинской помощи/giu, "БСМП")
    .replace(/Станция скорой медицинской помощи/giu, "ССМП")
    .replace(/Госпиталь для ветеранов войн/giu, "Госпиталь ветеранов")
    .replace(/\s+г\.?\s*Казани(?=\s|$)/giu, ", Казань")
    .replace(/\s+г\.?\s*Казань(?=\s|$)/giu, ", Казань")
    .replace(
      /\s+г\.?\s*(?:Наб\.?\s*Челны|Набережные Челны)(?=\s|$)/giu,
      ", Наб. Челны",
    )
    .replace(/(ЦРБ|РМБ|ЦРМБ|РБ)\s*\([^)]*\)\s*$/iu, "$1")
    .replace(
      /\s*\((?:Казань|Набережные Челны|Альметьевск|Агрыз|Азнакаево|Аксубаево|Актаныш|Алексеевское|Апастово|Арск|Бавлы|Бугульма|Буинск|Елабуга|Зеленодольск|Нижнекамск)\)\s*$/iu,
      "",
    )
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*№\s*(\d+)/gu, " №$1")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeMoCase(shortened);
}

export function moKey(name) {
  const normalized = cleanMoName(name)
    .replace(/\s*№\s*/gu, " №")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Approved special case from v4.6.0: the federal source may omit Kazan.
  if (/^гб №11(?:, казань)?$/u.test(normalized)) return "гб №11, казань";
  return normalized;
}

export function ratingMatchKey(name) {
  return cleanMoName(name)
    .toLowerCase()
    .replace(/наб\.?(?:ережные)?\s*челны/gu, "набережныечелны")
    .replace(/[^a-zа-я0-9№]+/giu, "");
}

export function ratingCoreKey(name) {
  return ratingMatchKey(name).replace(
    /(?:г)?(?:казань|казани|набережныечелны|набчелны)$/gu,
    "",
  );
}

export function isContextualSpassk(metric, name) {
  const cleaned = cleanMoName(name);
  return (
    SPASSK_CRB_REPORT_METRICS.has(metric) &&
    (/^(?:РКБ)(?: МЗ РТ)?$/iu.test(cleaned) || /Спасская ЦРБ/iu.test(cleaned))
  );
}

export function reportMoName(metric, name) {
  return isContextualSpassk(metric, name) ? "Спасская ЦРБ" : cleanMoName(name);
}

function addCandidate(index, key, organization) {
  const candidates = index.get(key) ?? [];
  if (!candidates.some((candidate) => candidate.oid === organization.oid)) {
    index.set(key, [...candidates, organization]);
  }
}

/** Build all deterministic indexes exactly once. */
export function createMoRegistryRuntime(registry) {
  const byOid = new Map(registry.organizations.map((org) => [org.oid, org]));
  const aliasCandidates = new Map();
  const looseCandidates = new Map();
  const coreCandidates = new Map();

  for (const org of registry.organizations) {
    for (const alias of org.aliases) {
      addCandidate(aliasCandidates, moKey(alias), org);
      addCandidate(looseCandidates, ratingMatchKey(alias), org);
      addCandidate(coreCandidates, ratingCoreKey(alias), org);
    }
  }

  function organizationByName(name) {
    const matches = aliasCandidates.get(moKey(name)) ?? [];
    if (matches.length === 1) return matches[0];
    const looseMatches = looseCandidates.get(ratingMatchKey(name)) ?? [];
    if (looseMatches.length === 1) return looseMatches[0];
    const coreMatches = coreCandidates.get(ratingCoreKey(name)) ?? [];
    return coreMatches.length === 1 ? coreMatches[0] : null;
  }

  function organization(row) {
    if (row?.oid && byOid.has(row.oid)) return byOid.get(row.oid);
    return organizationByName(row?.name ?? "");
  }

  function organizationForMetric(metric, row) {
    return isContextualSpassk(metric, row?.name ?? "")
      ? SPASSK_CRB_ORGANIZATION
      : organization(row);
  }

  function organizationByMetricAndName(metric, name) {
    return isContextualSpassk(metric, name)
      ? SPASSK_CRB_ORGANIZATION
      : organizationByName(name);
  }

  return Object.freeze({
    byOid,
    aliasCandidates,
    looseCandidates,
    coreCandidates,
    organization,
    organizationByName,
    organizationForMetric,
    organizationByMetricAndName,
  });
}

/** Resolve the set of registry OIDs represented by a metric dataset. */
export function resolvedOrganizationOids(runtime, metric, rows) {
  const result = new Set();
  for (const row of rows ?? []) {
    const organization = runtime.organizationForMetric(metric, row);
    if (organization?.oid) result.add(organization.oid);
  }
  return result;
}

/**
 * Formal guard for weekly refreshes: returns organizations present in the
 * previous comparable dataset but absent from the new one. No guessing.
 */
export function findDroppedOrganizations(runtime, metric, previousRows, currentRows) {
  const previous = resolvedOrganizationOids(runtime, metric, previousRows);
  const current = resolvedOrganizationOids(runtime, metric, currentRows);
  return [...previous]
    .filter((oid) => !current.has(oid))
    .map((oid) => runtime.byOid.get(oid) ?? (oid === SPASSK_CRB_ORGANIZATION.oid ? SPASSK_CRB_ORGANIZATION : { oid }))
    .sort((a, b) => String(a.oid).localeCompare(String(b.oid)));
}
