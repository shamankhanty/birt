import { calculateSeptemberOrganization } from "./september-rating.js";
import { applyPediatricTherapistReferencePolicy } from "./pediatric-rating-policy.js";
import { octoberStaffAbsenceException, octoberAmbulatoryReconstruction } from "./october-rating-applicability.js";

function components(quantity) {
  const match = String(quantity ?? "").replace(/\s/g, "").match(/^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  return match ? match.slice(1).map(value => Number(value.replace(",", "."))) : [null, null];
}

export function buildOctoberRating(september, datasets, policy) {
  const byMetric = new Map(Object.entries(datasets).map(([id, dataset]) => [
    id,
    new Map(dataset.rows.flatMap(row => {
      const key = row.reportingEntityId || row.oid;
      return key ? [[key, row]] : [];
    })),
  ]));
  const rows = september.organizations.map(org => {
    const metrics = org.metrics.map(metric => {
      const dataset = datasets[metric.id];
      const current = byMetric.get(metric.id)?.get(org.key);
      const [sourceNumerator, sourceDenominator] = components(current?.julyQuantity);
      const reconstructed = octoberAmbulatoryReconstruction(org.key, metric.id, current);
      const numerator = reconstructed?.numerator ?? sourceNumerator;
      const denominator = reconstructed?.denominator ?? sourceDenominator;
      const periodKind = dataset?.periodKind === "cumulative" ? "cumulative" : metric.periodKind;
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
        status,
        reason: staffAbsence?.reason ?? reconstructed?.reason ?? (status === "missing" ? "Нет подтверждённых компонентов за октябрь" : null),
      };
    });
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
