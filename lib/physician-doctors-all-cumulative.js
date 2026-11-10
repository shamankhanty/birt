/**
 * Reconstruct ">=1 SEMD" from ten individually audited month exports.
 * The payload stores only aggregate MO OIDs and counts, never physician OIDs.
 * Do not use the source's monthly doctor count as a cumulative numerator.
 */
const PREFIX = "1.2.643.5.1.13.13.12.2.16.";

function assertCount(num, den, oid, period) {
  if (num === null && den === null) return;
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0 || num < 0 || num > den) {
    throw new Error(`Invalid cumulative doctorsAll components ${oid}, ${period}: ${num}/${den}`);
  }
}
function ratio(num, den) {
  return num === null || den === null ? null : num / den * 100;
}
function pair(num, den) {
  return num === null || den === null ? null : `${num} / ${den}`;
}

/**
 * @param {object} source - verified 2026-10 aggregated unique-physician source
 * @param {object} originalMonthly - immutable accepted month-only doctorsAll dataset
 * @param {object} originalPhysician - immutable accepted physician-metrics doctorsAll dataset
 */
export function createDoctorsAllCumulativeDatasets(source, originalMonthly, originalPhysician) {
  if (source?.indicator !== "doctorsAll" || source.period !== "01.01–31.10.2026" ||
      !Array.isArray(source.rows) || source.rows.length !== 126) {
    throw new Error("Unexpected doctorsAll cumulative source/perimeter");
  }
  const monthlyByOid = new Map(originalMonthly.rows.map(row => [row.oid, row]));
  const physicianByOid = new Map(originalPhysician.rows.map(row => [row.oid, row]));
  const seen = new Set();
  const monthRows = [];
  const physicianRows = [];
  let sepNum = 0, sepDen = 0, octNum = 0, octDen = 0, visibleOctober = 0;
  for (const record of source.rows) {
    if (!Array.isArray(record) || record.length !== 5) throw new Error("Bad doctorsAll source row");
    const [suffix, septemberNumerator, septemberDenominator, octoberNumerator, octoberDenominator] = record;
    const oid = PREFIX + String(suffix);
    const baseline = monthlyByOid.get(oid);
    const physicianBaseline = physicianByOid.get(oid);
    if (!baseline || !physicianBaseline || seen.has(oid)) throw new Error("Unmatched or duplicate MO in doctorsAll: " + oid);
    seen.add(oid);
    assertCount(septemberNumerator, septemberDenominator, oid, "September");
    assertCount(octoberNumerator, octoberDenominator, oid, "October");
    if (septemberNumerator === null || septemberDenominator === null) throw new Error("Missing September doctor roster for " + oid);
    const hasOctober = octoberNumerator !== null;
    if (hasOctober) {
      const monthlyComponents = String(baseline.julyQuantity ?? "").replace(/\s/g,"").split("/").map(Number);
      if (monthlyComponents.length !== 2 || monthlyComponents[1] !== octoberDenominator ||
          monthlyComponents[0] > octoberNumerator ||
          physicianBaseline.volume !== octoberDenominator ||
          physicianBaseline.count !== monthlyComponents[0]) {
        throw new Error("Source month/roster mismatch in doctorsAll: " + oid);
      }
      visibleOctober++;
      octNum += octoberNumerator;
      octDen += octoberDenominator;
    } else if (baseline.julyQuantity !== null || physicianBaseline.sourceStatus !== "no_source_row") {
      throw new Error("Unconfirmed no-source month in doctorsAll: " + oid);
    }
    sepNum += septemberNumerator;
    sepDen += septemberDenominator;
    const previous = ratio(septemberNumerator, septemberDenominator);
    const fact = ratio(octoberNumerator, octoberDenominator);
    const warning = hasOctober ? null : "Нет октябрьской строки ФРМР: значение не рассчитано, ноль не подставляется.";
    monthRows.push({
      name: baseline.name, oid,
      june: previous, july: fact,
      juneQuantity: pair(septemberNumerator, septemberDenominator),
      julyQuantity: pair(octoberNumerator, octoberDenominator),
      change: fact === null ? null : fact - previous,
      ...(warning ? {sourceStatus:"no_source_row",sourceWarning:warning} : {}),
    });
    physicianRows.push({
      name: physicianBaseline.name, oid,
      fact, count: octoberNumerator, volume: octoberDenominator,
      previous, trend: fact === null ? null : fact - previous,
      sourceWarning: warning,
      ...(warning ? {sourceStatus:"no_source_row"} : {}),
    });
  }
  if (sepNum !== 11637 || sepDen !== 13542 || octNum !== 12010 || octDen !== 13691 || visibleOctober !== 124) {
    throw new Error("Cumulative doctorsAll checksum/coverage mismatch");
  }
  const note = "Январь–октябрь 2026: уникальные OID врачей с ≥1 зарегистрированным СЭМД, входящие в состав ФРМР соответствующей МО на 31.10, / работающие врачи ФРМР на 31.10. Источники — десять месячных выгрузок BI с индивидуальной детализацией; повторные врачи исключены. Методика кадровых исключений принимается из BI/ФРМР; независимая проверка исключений не проводилась. Две отсутствующие октябрьские МО — без факта.";
  return {
    monthly: {
      unit: "%", periodKind: "cumulative",
      previousLabel: "01.01–30.09.2026", currentLabel: "01.01–31.10.2026",
      regional: {
        previous: {numerator:sepNum, denominator:sepDen},
        current: {numerator:octNum, denominator:octDen},
      },
      rows: monthRows,
    },
    physician: {
      ...originalPhysician,
      date: "31.10.2026", period: "01.01–31.10.2026",
      periodType: "month", periodKind: "cumulative",
      previousDate: "30.09.2026", previousPeriod: "01.01–30.09.2026",
      note,
      summary: {numerator:octNum, denominator:octDen, fact:octNum/octDen*100},
      rows: physicianRows,
    },
  };
}
