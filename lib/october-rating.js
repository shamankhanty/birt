import { calculateSeptemberOrganization } from "./september-rating.js";
import { applyPediatricTherapistReferencePolicy } from "./pediatric-rating-policy.js";
import { octoberStaffAbsenceException, octoberAmbulatoryReconstruction } from "./october-rating-applicability.js";
import maxTargets from "../config/max-targets-2026.json" with { type: "json" };
import maxOctober from "../app/rating/max-october-2026.json" with { type: "json" };
import rkbBranchCatalog from "../config/rkb-spassk-branch.json" with { type: "json" };

function components(quantity) {
  const match = String(quantity ?? "").replace(/\s/g, "").match(/^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  return match ? match.slice(1).map(value => Number(value.replace(",", "."))) : [null, null];
}

export function buildOctoberRating(september, datasets, policy) {
  const maxHasSeparateBranchRow = maxOctober.rows.some(row =>
    row.reportingEntityId === "context:spassk-crb" ||
    row.oid === "1.2.643.5.1.13.13.12.2.16.18650");
  const maxBranchAliasAllowed = ["tmkMaxCount", "elnMaxCount"].every(metric =>
    rkbBranchCatalog.reportAliases.rules.some(rule => rule.metrics.includes(metric)));
  const maxByOid = new Map(maxOctober.rows.map(row => [
    row.reportingEntityId ||
      (maxBranchAliasAllowed && !maxHasSeparateBranchRow && row.oid === rkbBranchCatalog.parent.oid
        ? "context:spassk-crb"
        : row.oid),
    row,
  ]));
  const spasskTarget = Object.values(maxTargets.organizationPlans).find(target => /Спасская ЦРБ/iu.test(target.name ?? ""));
  const byMetric = new Map(Object.entries(datasets).map(([id, dataset]) => {
    const hasExplicitBranchRow = dataset.rows.some(row =>
      row.reportingEntityId === "context:spassk-crb" || row.spOid ||
      /Спасская\s+ЦРБ/iu.test(row.name ?? ""));
    const aliasRule = rkbBranchCatalog.reportAliases.rules.find(rule => rule.metrics.includes(id));
    return [id, new Map(dataset.rows.flatMap(row => {
      const parentNamedRkb = row.oid === rkbBranchCatalog.parent.oid &&
        /^(?:ГАУЗ\s*)?["«]?РКБ(?:\s+МЗ\s+РТ)?["»]?$/iu.test(String(row.name ?? "").trim());
      const key = row.reportingEntityId ||
        (aliasRule && !hasExplicitBranchRow && parentNamedRkb ? "context:spassk-crb" : row.oid);
      return key ? [[key, row]] : [];
    }))];
  }));
  const rows = september.organizations.map(org => {
    const metrics = org.metrics.map(metric => {
      const dataset = datasets[metric.id];
      const current = byMetric.get(metric.id)?.get(org.key);
      const [sourceNumerator, sourceDenominator] = components(current?.julyQuantity);
      const reconstructed = octoberAmbulatoryReconstruction(org.key, metric.id, current);
      const numerator = reconstructed?.numerator ?? sourceNumerator;
      const denominator = reconstructed?.denominator ?? sourceDenominator;
      const periodKind = dataset?.periodKind === "cumulative" ? "cumulative" : metric.periodKind;
      const monthlyDoctorsAll = metric.id === "doctorsAll" && periodKind !== "cumulative";
      const staffAbsence = octoberStaffAbsenceException(org.key, metric.id, current);
      const status = staffAbsence ? "not_applicable" : denominator === 0 ? "not_applicable" :
        numerator !== null && denominator > 0 && (reconstructed || Number.isFinite(current?.july)) ? "available" : "missing";
      const { s122, s228, mappingNote, ...previousMetric } = metric;
      return {
        ...previousMetric,
        name: metric.id === "semd228" ? "Регистрация СЭМД по закрытым случаям ДОГВН/ПМО" : metric.name,
        periodKind,
        period: periodKind === "cumulative" ? "01.01–31.10.2026" : "01.10–31.10.2026",
        numerator,
        denominator,
        fact: status === "available" ? (reconstructed ? 100 * numerator / denominator : current.july) : null,
        status: monthlyDoctorsAll && status === "available" ? "reference_only" : status,
        reason: monthlyDoctorsAll ? "Месячный факт за октябрь — справочно. Методика требует уникальных врачей с СЭМД за 01.01–31.10 и состав ФРМР на 31.10; накопительной выгрузки нет, в балл не включён." : staffAbsence?.reason ?? reconstructed?.reason ?? (status === "missing" ? "Нет подтверждённых компонентов за октябрь" : null),
      };
    });
    const target = maxTargets.organizationPlans[org.key] ??
      (org.key === "context:spassk-crb" ? spasskTarget : null);
    for (const [id, title, column] of [["tmkMax", "ТМК посредством МАХ — выполнение плана", "tmk"], ["elnMax", "ЛВН посредством МАХ — выполнение плана", "eln"]]) {
      const plan = target?.[column]?.["2026-10"];
      const actual = maxByOid.get(org.key)?.[column];
      const status = !(plan > 0) ? "not_applicable" : Number.isFinite(actual) ? "available" : "missing";
      metrics.push({ id, name: title, block: "services", family: "services", periodKind: "cumulative",
        period: "01.01–31.10.2026", plan: 100,
        numerator: status === "available" ? actual : null,
        denominator: status === "available" ? plan : null,
        fact: status === "available" ? 100 * actual / plan : null, status,
        reason: status === "not_applicable" ? "Для МО не установлен план МАХ на 31.10" : status === "missing" ? "Нет подтверждённого накопительного факта МАХ на 31.10" : null,
      });
    }
    const row = calculateSeptemberOrganization(applyPediatricTherapistReferencePolicy({ ...org, metrics }), policy);
    return {
      ...row,
      place: null,
      oldPlace: null,
      oldScore: null,
      reasons: row.missing.length ? ["Официальное место появится после подтверждения всех обязательных показателей МО."] : [],
    };
  });
  for (const type of new Set(rows.map(row => row.type))) {
    const ranked = rows.filter(row => row.type === type && row.complete)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
    ranked.forEach((row, index) => {
      const previous = ranked[index - 1];
      row.place = previous && Math.abs(previous.score - row.score) < 1e-9 ? previous.place : index + 1;
    });
  }
  return rows;
}
