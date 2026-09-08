import { createMoRegistryRuntime } from "./mo-registry.js";
import {
  datasetBelongsToReportingMonth,
  inferPeriodKind,
  resolveReportingPeriods,
} from "./period-engine.js";

export const VALIDATION_STATUS = Object.freeze({
  PASS: "PASS",
  WARNING: "WARNING",
  FAIL: "FAIL",
});

const STATUS_WEIGHT = { PASS: 0, WARNING: 1, FAIL: 2 };
const ROUND_TOLERANCE = 0.015;

const stableText = (value) => String(value ?? "").trim().replace(/\s+/gu, " ");

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), "ru"));
}

function issueFingerprint(issue) {
  return [
    issue.kind,
    issue.scope ?? "",
    issue.metric ?? "",
    issue.organizationOid ?? "",
    stableText(issue.organizationName),
    issue.field ?? "",
  ].join("|");
}

function statusForIssues(issues) {
  if (!issues.length) return VALIDATION_STATUS.PASS;
  return issues.reduce(
    (current, issue) => STATUS_WEIGHT[issue.status] > STATUS_WEIGHT[current] ? issue.status : current,
    VALIDATION_STATUS.PASS,
  );
}

function makeCheck({ id, category, title, issues = [], passMessage, details = {} }) {
  const status = statusForIssues(issues);
  return {
    id,
    category,
    title,
    status,
    blocking: status === VALIDATION_STATUS.FAIL,
    requiresAiReview: issues.some((issue) => issue.requiresAiReview === true),
    message: status === VALIDATION_STATUS.PASS ? passMessage : `${issues.length} issue(s) detected`,
    details,
    issues,
  };
}

function metricIsRatingActive(indicatorRegistry, metric) {
  return indicatorRegistry?.indicators?.[metric]?.rating?.baselineActive === true;
}

function normalizeDatasetSources({ moData = {}, monthlyMo = {}, operationalMo = {}, organizationStatus = {}, physicianMetrics = null }) {
  const sources = [
    ["mo-data", moData],
    ["monthly-mo", monthlyMo],
    ["operational-mo", operationalMo],
    ["organization-status", organizationStatus],
  ];
  if (physicianMetrics?.datasets) sources.push(["physician-metrics", physicianMetrics.datasets]);
  return sources;
}

function sourceKey(scope, metric) {
  return `${scope}:${metric}`;
}

function currentValue(row) {
  if (Object.prototype.hasOwnProperty.call(row, "july")) return row.july;
  return row.fact;
}

function previousValue(row) {
  if (Object.prototype.hasOwnProperty.call(row, "june")) return row.june;
  return row.previous;
}

function rowOrganizationIdentity(runtime, metric, row) {
  const org = runtime.organizationForMetric(metric, row);
  if (org?.oid) return { key: `OID:${org.oid}`, oid: org.oid, name: org.shortName ?? org.name ?? row.name };
  return { key: `RAW:${stableText(row?.name)}`, oid: null, name: stableText(row?.name) };
}

function collectCurrentState({ indicatorRegistry, moRegistry, moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics }) {
  const runtime = createMoRegistryRuntime(moRegistry);
  const sources = normalizeDatasetSources({ moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics });
  const unresolved = [];
  const outOfRange = [];
  const missingCurrent = [];
  const resolvedOidsByDataset = {};
  const rowCounts = {};

  for (const [scope, datasets] of sources) {
    for (const [metric, dataset] of Object.entries(datasets ?? {})) {
      if (!dataset || typeof dataset !== "object" || !Array.isArray(dataset.rows)) continue;
      const key = sourceKey(scope, metric);
      rowCounts[key] = dataset.rows.length;
      const resolved = [];
      for (const row of dataset.rows) {
        const identity = rowOrganizationIdentity(runtime, metric, row);
        if (identity.oid) resolved.push(identity.oid);
        else {
          unresolved.push({
            kind: "unresolved_organization",
            scope,
            metric,
            organizationOid: null,
            organizationName: row?.name ?? "",
            field: "name",
          });
        }

        const unit = dataset.unit ?? indicatorRegistry?.indicators?.[metric]?.unit;
        if (unit === "%") {
          for (const field of ["fact", "previous", "june", "july"]) {
            const value = row?.[field];
            if (typeof value !== "number") continue;
            if (value < 0) {
              outOfRange.push({
                kind: "negative_percentage",
                scope,
                metric,
                organizationOid: identity.oid,
                organizationName: identity.name,
                field,
                value,
              });
            } else if (value > 100) {
              outOfRange.push({
                kind: "percentage_above_100",
                scope,
                metric,
                organizationOid: identity.oid,
                organizationName: identity.name,
                field,
                value,
              });
            }
          }
        }

        const previous = previousValue(row);
        const current = currentValue(row);
        if (typeof previous === "number" && (current === null || current === undefined)) {
          missingCurrent.push({
            kind: "missing_current_value",
            scope,
            metric,
            organizationOid: identity.oid,
            organizationName: identity.name,
            field: Object.prototype.hasOwnProperty.call(row, "july") ? "july" : "fact",
          });
        }
      }
      resolvedOidsByDataset[key] = sortedUnique(resolved);
    }
  }

  return {
    unresolved,
    outOfRange,
    missingCurrent,
    resolvedOidsByDataset,
    rowCounts,
  };
}

export function createValidationSnapshot(input) {
  const state = collectCurrentState(input);
  return {
    schemaVersion: 1,
    baselineVersion: input.indicatorRegistry?.baselineVersion ?? null,
    acknowledgedFingerprints: sortedUnique([
      ...state.unresolved,
      ...state.outOfRange,
      ...state.missingCurrent,
    ].map(issueFingerprint)),
    resolvedOidsByDataset: state.resolvedOidsByDataset,
    rowCounts: state.rowCounts,
    acknowledgedCounts: {
      unresolvedOrganizations: state.unresolved.length,
      percentageAnomalies: state.outOfRange.length,
      missingCurrentValues: state.missingCurrent.length,
    },
  };
}

function decorateIssue(issue, { indicatorRegistry, baselineFingerprints }) {
  const fingerprint = issueFingerprint(issue);
  const acknowledged = baselineFingerprints.has(fingerprint);
  const active = metricIsRatingActive(indicatorRegistry, issue.metric);
  let status = VALIDATION_STATUS.WARNING;
  let requiresAiReview = false;
  let reviewReason = null;

  if (issue.kind === "duplicate_organization" || issue.kind === "duplicate_registry_oid" || issue.kind === "numbered_alias_conflict") {
    status = VALIDATION_STATUS.FAIL;
    requiresAiReview = true;
    reviewReason = "FAIL";
  } else if (issue.kind === "calculation_mismatch" || issue.kind === "trend_mismatch") {
    status = VALIDATION_STATUS.FAIL;
    requiresAiReview = true;
    reviewReason = "FAIL";
  } else if (issue.kind === "period_kind_mismatch" || issue.kind === "rating_period_mismatch" || issue.kind === "registry_missing_indicator") {
    status = VALIDATION_STATUS.FAIL;
    requiresAiReview = true;
    reviewReason = issue.kind.includes("period") ? "methodology" : "FAIL";
  } else if (issue.kind === "negative_percentage") {
    status = VALIDATION_STATUS.FAIL;
    requiresAiReview = true;
    reviewReason = "anomaly";
  } else if (issue.kind === "percentage_above_100") {
    status = VALIDATION_STATUS.WARNING;
    requiresAiReview = true;
    reviewReason = "anomaly";
  } else if (issue.kind === "unresolved_organization" || issue.kind === "dropped_organization" || issue.kind === "missing_current_value" || issue.kind === "row_count_drop") {
    status = active ? VALIDATION_STATUS.FAIL : VALIDATION_STATUS.WARNING;
    requiresAiReview = status === VALIDATION_STATUS.FAIL;
    reviewReason = requiresAiReview ? "FAIL" : null;
  }

  return { ...issue, fingerprint, acknowledged, status, requiresAiReview, reviewReason };
}

function unacknowledgedIssues(issues, context) {
  return issues
    .map((issue) => decorateIssue(issue, context))
    .filter((issue) => !issue.acknowledged);
}

function registryChecks({ indicatorRegistry, moRegistry }) {
  const checks = [];
  const indicators = indicatorRegistry?.indicators ?? {};
  const missingMetadata = [];
  for (const [id, item] of Object.entries(indicators)) {
    for (const [field, ok] of [
      ["name", Boolean(item?.name)],
      ["formula", Boolean(item?.formula)],
      ["source", item?.source !== null && typeof item?.source === "object"],
      ["period.kind", Boolean(item?.period?.kind)],
      ["direction", Boolean(item?.direction)],
      ["unit", Object.prototype.hasOwnProperty.call(item ?? {}, "unit")],
      ["rating", item?.rating !== null && typeof item?.rating === "object"],
    ]) {
      if (!ok) missingMetadata.push({ metric: id, field });
    }
  }
  checks.push(makeCheck({
    id: "registry.indicator_metadata",
    category: "schema",
    title: "Полнота единого реестра показателей",
    issues: missingMetadata.map((item) => ({ ...item, kind: "registry_missing_indicator", status: VALIDATION_STATUS.FAIL, requiresAiReview: true, reviewReason: "FAIL" })),
    passMessage: `${Object.keys(indicators).length} indicators have required metadata`,
    details: { indicatorCount: Object.keys(indicators).length },
  }));

  const seenOid = new Set();
  const duplicateOids = [];
  for (const org of moRegistry?.organizations ?? []) {
    if (seenOid.has(org.oid)) duplicateOids.push({
      kind: "duplicate_registry_oid",
      organizationOid: org.oid,
      organizationName: org.shortName ?? org.name,
      status: VALIDATION_STATUS.FAIL,
      requiresAiReview: true,
      reviewReason: "FAIL",
    });
    seenOid.add(org.oid);
  }
  checks.push(makeCheck({
    id: "registry.mo_oid_uniqueness",
    category: "duplicates",
    title: "Уникальность OID в справочнике МО",
    issues: duplicateOids,
    passMessage: `${seenOid.size} registry OIDs are unique`,
    details: { organizationCount: moRegistry?.organizations?.length ?? 0 },
  }));

  const numberTokens = (value) => [...String(value ?? "").matchAll(/№\s*(\d+)/gu)].map((match) => match[1]);
  const numberedConflicts = [];
  for (const org of moRegistry?.organizations ?? []) {
    const target = new Set(numberTokens(`${org.name} ${org.shortName}`));
    for (const alias of org.aliases ?? []) {
      const source = new Set(numberTokens(alias));
      if (source.size && target.size && [...source].some((number) => !target.has(number))) {
        numberedConflicts.push({
          kind: "numbered_alias_conflict",
          organizationOid: org.oid,
          organizationName: org.shortName ?? org.name,
          field: alias,
          status: VALIDATION_STATUS.FAIL,
          requiresAiReview: true,
          reviewReason: "FAIL",
        });
      }
    }
  }
  checks.push(makeCheck({
    id: "registry.numbered_alias_safety",
    category: "duplicates",
    title: "Безопасность алиасов номерных МО",
    issues: numberedConflicts,
    passMessage: "No numbered facility alias crosses organization numbers",
  }));

  return checks;
}

function coverageCheck({ indicatorRegistry, moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics }) {
  const registryIds = new Set(Object.keys(indicatorRegistry?.indicators ?? {}));
  const sourceIds = new Set();
  for (const [, datasets] of normalizeDatasetSources({ moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics })) {
    for (const [id, dataset] of Object.entries(datasets ?? {})) {
      if (dataset && typeof dataset === "object" && Array.isArray(dataset.rows)) sourceIds.add(id);
    }
  }
  const missing = [...sourceIds].filter((id) => !registryIds.has(id)).sort().map((metric) => ({
    kind: "registry_missing_indicator",
    metric,
    status: VALIDATION_STATUS.FAIL,
    requiresAiReview: true,
    reviewReason: "FAIL",
  }));
  return makeCheck({
    id: "registry.runtime_coverage",
    category: "schema",
    title: "Покрытие runtime-наборов реестром показателей",
    issues: missing,
    passMessage: `${sourceIds.size} runtime datasets are covered by the indicator registry`,
    details: { runtimeDatasetCount: sourceIds.size, registryIndicatorCount: registryIds.size },
  });
}

function registryMetadataAlignmentCheck({ indicatorRegistry, moData, operationalMo, organizationStatus, physicianMetrics }) {
  const issues = [];
  let inspected = 0;
  const sources = [
    ["mo-data", moData],
    ["operational-mo", operationalMo],
    ["organization-status", organizationStatus],
    ["physician-metrics", physicianMetrics?.datasets ?? {}],
  ];
  for (const [scope, datasets] of sources) {
    for (const [metric, dataset] of Object.entries(datasets ?? {})) {
      const item = indicatorRegistry?.indicators?.[metric];
      if (!item || !dataset || typeof dataset !== "object") continue;
      inspected += 1;
      const expectedPlan = item?.plan?.value ?? null;
      const actualPlan = Object.prototype.hasOwnProperty.call(dataset, "plan") ? (dataset.plan ?? null) : null;
      if (actualPlan !== expectedPlan) {
        issues.push({
          kind: "registry_metadata_conflict",
          scope,
          metric,
          field: "plan",
          expected: expectedPlan,
          actual: actualPlan,
          status: VALIDATION_STATUS.FAIL,
          requiresAiReview: true,
          reviewReason: "methodology",
        });
      }
      const expectedDirection = item?.direction ?? "higher";
      const actualDirection = dataset?.direction ?? "higher";
      if (actualDirection !== expectedDirection) {
        issues.push({
          kind: "registry_metadata_conflict",
          scope,
          metric,
          field: "direction",
          expected: expectedDirection,
          actual: actualDirection,
          status: VALIDATION_STATUS.FAIL,
          requiresAiReview: true,
          reviewReason: "methodology",
        });
      }
    }
  }
  return makeCheck({
    id: "registry.metadata_source_alignment",
    category: "schema",
    title: "Соответствие metadata источников каноническому реестру",
    issues,
    passMessage: `${inspected} source datasets match canonical plan/direction metadata`,
    details: { inspectedDatasets: inspected },
  });
}

function duplicateDataCheck({ indicatorRegistry, moRegistry, moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics }) {
  const runtime = createMoRegistryRuntime(moRegistry);
  const issues = [];
  let inspectedRows = 0;
  for (const [scope, datasets] of normalizeDatasetSources({ moData, monthlyMo, operationalMo, organizationStatus, physicianMetrics })) {
    for (const [metric, dataset] of Object.entries(datasets ?? {})) {
      if (!Array.isArray(dataset?.rows)) continue;
      const seen = new Map();
      for (const row of dataset.rows) {
        inspectedRows += 1;
        const identity = rowOrganizationIdentity(runtime, metric, row);
        if (seen.has(identity.key)) {
          issues.push({
            kind: "duplicate_organization",
            scope,
            metric,
            organizationOid: identity.oid,
            organizationName: identity.name,
            field: "rows",
            duplicateOf: seen.get(identity.key),
          });
        } else {
          seen.set(identity.key, row.name);
        }
      }
    }
  }
  const decorated = issues.map((issue) => decorateIssue(issue, { indicatorRegistry, baselineFingerprints: new Set() }));
  return makeCheck({
    id: "data.duplicate_organizations",
    category: "duplicates",
    title: "Дубли МО внутри одного показателя",
    issues: decorated,
    passMessage: `${inspectedRows} rows contain no duplicate organization within a dataset`,
    details: { inspectedRows },
  });
}

function calculationChecks({ moData, operationalMo, moDetailOids }) {
  const ratioIssues = [];
  const trendIssues = [];
  let ratioRows = 0;
  let trendRows = 0;

  for (const [metric, dataset] of Object.entries(moData ?? {})) {
    if (dataset?.mode === "count" || dataset?.mode === "presence") continue;
    const detailMap = moDetailOids?.[metric];
    if (detailMap) {
      for (const row of dataset.rows ?? []) {
        if (!row.oid || !detailMap[row.oid]) continue;
        const detail = detailMap[row.oid];
        if (typeof detail.registered !== "number" || typeof detail.volume !== "number" || detail.volume === 0 || typeof row.fact !== "number") continue;
        ratioRows += 1;
        const expected = detail.registered / detail.volume * 100;
        if (Math.abs(row.fact - expected) >= ROUND_TOLERANCE || (typeof row.count === "number" && row.count !== detail.registered)) {
          ratioIssues.push({
            kind: "calculation_mismatch",
            scope: "mo-data",
            metric,
            organizationOid: row.oid,
            organizationName: row.name,
            field: "fact",
            expected,
            actual: row.fact,
            registered: detail.registered,
            volume: detail.volume,
          });
        }
      }
    }
    for (const row of dataset.rows ?? []) {
      if (typeof row.registered === "number" && typeof row.volume === "number" && row.volume !== 0 && typeof row.fact === "number") {
        ratioRows += 1;
        const expected = row.registered / row.volume * 100;
        if (Math.abs(row.fact - expected) >= ROUND_TOLERANCE) {
          ratioIssues.push({
            kind: "calculation_mismatch",
            scope: "mo-data",
            metric,
            organizationOid: row.oid ?? null,
            organizationName: row.name,
            field: "fact",
            expected,
            actual: row.fact,
            registered: row.registered,
            volume: row.volume,
          });
        }
      }
    }
  }

  for (const [scope, datasets] of [["mo-data", moData], ["operational-mo", operationalMo]]) {
    for (const [metric, dataset] of Object.entries(datasets ?? {})) {
      for (const row of dataset?.rows ?? []) {
        if (typeof row.fact !== "number" || typeof row.previous !== "number" || typeof row.trend !== "number") continue;
        trendRows += 1;
        const expected = row.fact - row.previous;
        if (Math.abs(row.trend - expected) > 1e-9) {
          trendIssues.push({
            kind: "trend_mismatch",
            scope,
            metric,
            organizationOid: row.oid ?? null,
            organizationName: row.name,
            field: "trend",
            expected,
            actual: row.trend,
          });
        }
      }
    }
  }

  const decorate = (issue) => ({ ...issue, status: VALIDATION_STATUS.FAIL, requiresAiReview: true, reviewReason: "FAIL", fingerprint: issueFingerprint(issue), acknowledged: false });
  return [
    makeCheck({
      id: "calculation.ratio_components",
      category: "calculation",
      title: "Арифметическая сверка числителя, знаменателя и доли",
      issues: ratioIssues.map(decorate),
      passMessage: `${ratioRows} ratio rows reconcile to numerator/denominator components`,
      details: { inspectedRows: ratioRows, tolerancePercentagePoints: ROUND_TOLERANCE },
    }),
    makeCheck({
      id: "calculation.trend",
      category: "calculation",
      title: "Арифметическая сверка динамики",
      issues: trendIssues.map(decorate),
      passMessage: `${trendRows} trend rows reconcile to fact minus previous`,
      details: { inspectedRows: trendRows },
    }),
  ];
}

function periodChecks({ indicatorRegistry, moData, operationalMo, organizationStatus, monthlyMo, physicianMetrics, reporting }) {
  const kindIssues = [];
  let inspectedKinds = 0;
  for (const [scope, datasets] of [["mo-data", moData], ["operational-mo", operationalMo], ["organization-status", organizationStatus]]) {
    for (const [metric, dataset] of Object.entries(datasets ?? {})) {
      const expected = indicatorRegistry?.indicators?.[metric]?.period?.kind;
      if (!expected || !dataset?.period) continue;
      inspectedKinds += 1;
      const inferred = inferPeriodKind(dataset);
      if (inferred !== expected) {
        kindIssues.push({
          kind: "period_kind_mismatch",
          scope,
          metric,
          field: "period",
          expected,
          actual: inferred,
          period: dataset.period,
          status: VALIDATION_STATUS.FAIL,
          requiresAiReview: true,
          reviewReason: "methodology",
          acknowledged: false,
          fingerprint: issueFingerprint({ kind: "period_kind_mismatch", scope, metric, field: "period" }),
        });
      }
    }
  }

  const mergedData = { ...(moData ?? {}), ...(operationalMo ?? {}), ...(organizationStatus ?? {}), ...(physicianMetrics?.datasets ?? {}) };
  const ratingIssues = [];
  let activeRatingCount = 0;
  for (const [metric, item] of Object.entries(indicatorRegistry?.indicators ?? {})) {
    if (item?.rating?.baselineActive !== true) continue;
    activeRatingCount += 1;
    let dataset = monthlyMo?.[metric];
    if (!dataset && mergedData?.[metric]) dataset = mergedData[metric];
    if (!dataset) {
      ratingIssues.push({
        kind: "rating_period_mismatch",
        metric,
        field: "dataset",
        expected: reporting.latestFullMonth.label,
        actual: null,
        status: VALIDATION_STATUS.FAIL,
        requiresAiReview: true,
        reviewReason: "methodology",
        acknowledged: false,
        fingerprint: issueFingerprint({ kind: "rating_period_mismatch", metric, field: "dataset" }),
      });
      continue;
    }
    const enriched = dataset;
    if (!datasetBelongsToReportingMonth(enriched, reporting.latestFullMonth)) {
      ratingIssues.push({
        kind: "rating_period_mismatch",
        metric,
        field: "period",
        expected: reporting.latestFullMonth.label,
        actual: dataset.currentLabel ?? dataset.period ?? dataset.date ?? null,
        status: VALIDATION_STATUS.FAIL,
        requiresAiReview: true,
        reviewReason: "methodology",
        acknowledged: false,
        fingerprint: issueFingerprint({ kind: "rating_period_mismatch", metric, field: "period" }),
      });
    }
  }

  return [
    makeCheck({
      id: "period.kind_compatibility",
      category: "period",
      title: "Соответствие типа периода реестру показателей",
      issues: kindIssues,
      passMessage: `${inspectedKinds} source periods match their registry period kind`,
      details: { inspectedDatasets: inspectedKinds },
    }),
    makeCheck({
      id: "period.rating_month",
      category: "period",
      title: "Сопоставимость периода рейтинга",
      issues: ratingIssues,
      passMessage: `${activeRatingCount} rating indicators belong to ${reporting.latestFullMonth.label}`,
      details: {
        activeRatingIndicators: activeRatingCount,
        latestFullMonth: reporting.latestFullMonth.label,
        previousFullMonth: reporting.previousFullMonth.label,
        latestObservedDate: reporting.latestObservedDate,
        hasPartialNewerMonth: reporting.hasPartialNewerMonth,
      },
    }),
  ];
}

function dataDeltaChecks({ indicatorRegistry, currentState, baselineSnapshot }) {
  const baselineFingerprints = new Set(baselineSnapshot?.acknowledgedFingerprints ?? []);
  const context = { indicatorRegistry, baselineFingerprints };
  const unresolved = unacknowledgedIssues(currentState.unresolved, context);
  const anomalies = unacknowledgedIssues(currentState.outOfRange, context);
  const missing = unacknowledgedIssues(currentState.missingCurrent, context);

  const dropped = [];
  for (const [key, baselineOids] of Object.entries(baselineSnapshot?.resolvedOidsByDataset ?? {})) {
    const currentOids = new Set(currentState.resolvedOidsByDataset[key] ?? []);
    const [scope, metric] = key.split(":", 2);
    for (const oid of baselineOids) {
      if (!currentOids.has(oid)) {
        dropped.push({
          kind: "dropped_organization",
          scope,
          metric,
          organizationOid: oid,
          organizationName: oid,
          field: "rows",
        });
      }
    }
  }
  const droppedDecorated = unacknowledgedIssues(dropped, context);

  const rowCountDrops = [];
  for (const [key, baselineCount] of Object.entries(baselineSnapshot?.rowCounts ?? {})) {
    const currentCount = currentState.rowCounts[key];
    if (typeof currentCount !== "number" || currentCount >= baselineCount) continue;
    const [scope, metric] = key.split(":", 2);
    rowCountDrops.push({
      kind: "row_count_drop",
      scope,
      metric,
      field: "rows",
      previousCount: baselineCount,
      currentCount,
    });
  }
  const rowCountDecorated = unacknowledgedIssues(rowCountDrops, context);

  return [
    makeCheck({
      id: "data.new_unresolved_organizations",
      category: "completeness",
      title: "Новые несопоставленные названия МО",
      issues: unresolved,
      passMessage: `No new unresolved organizations beyond ${baselineSnapshot?.acknowledgedCounts?.unresolvedOrganizations ?? 0} acknowledged baseline rows`,
      details: {
        currentUnresolvedRows: currentState.unresolved.length,
        acknowledgedBaselineRows: baselineSnapshot?.acknowledgedCounts?.unresolvedOrganizations ?? 0,
      },
    }),
    makeCheck({
      id: "data.dropped_organizations",
      category: "completeness",
      title: "МО, пропавшие из сопоставимого набора",
      issues: droppedDecorated,
      passMessage: "No organization present in the accepted reference disappeared from a comparable dataset",
    }),
    makeCheck({
      id: "data.row_count_drop",
      category: "completeness",
      title: "Снижение количества строк в наборе",
      issues: rowCountDecorated,
      passMessage: "No dataset has fewer rows than the accepted reference",
    }),
    makeCheck({
      id: "data.missing_current_values",
      category: "completeness",
      title: "Пропуски текущего значения при наличии предыдущего",
      issues: missing,
      passMessage: `No new missing current values beyond ${baselineSnapshot?.acknowledgedCounts?.missingCurrentValues ?? 0} acknowledged baseline cases`,
      details: {
        currentMissingValues: currentState.missingCurrent.length,
        acknowledgedBaselineCases: baselineSnapshot?.acknowledgedCounts?.missingCurrentValues ?? 0,
      },
    }),
    makeCheck({
      id: "data.percentage_anomalies",
      category: "anomaly",
      title: "Новые аномальные процентные значения",
      issues: anomalies,
      passMessage: `No new percentage anomalies beyond ${baselineSnapshot?.acknowledgedCounts?.percentageAnomalies ?? 0} acknowledged baseline cases`,
      details: {
        currentAnomalyRows: currentState.outOfRange.length,
        acknowledgedBaselineCases: baselineSnapshot?.acknowledgedCounts?.percentageAnomalies ?? 0,
      },
    }),
  ];
}

export function validateDashboard(input) {
  const reporting = input.reporting ?? resolveReportingPeriods({
    monthlyDatasets: input.monthlyMo,
    datasets: [
      ...Object.values(input.moData ?? {}),
      ...Object.values(input.operationalMo ?? {}),
      ...Object.values(input.organizationStatus ?? {}),
    ],
    physicianMetrics: input.physicianMetrics,
  });
  const currentState = collectCurrentState(input);
  const checks = [
    ...registryChecks(input),
    coverageCheck(input),
    registryMetadataAlignmentCheck(input),
    duplicateDataCheck(input),
    ...calculationChecks(input),
    ...periodChecks({ ...input, reporting }),
    ...dataDeltaChecks({
      indicatorRegistry: input.indicatorRegistry,
      currentState,
      baselineSnapshot: input.baselineSnapshot,
    }),
  ];
  const counts = Object.fromEntries(Object.values(VALIDATION_STATUS).map((status) => [status, checks.filter((check) => check.status === status).length]));
  const overallStatus = checks.reduce(
    (status, check) => STATUS_WEIGHT[check.status] > STATUS_WEIGHT[status] ? check.status : status,
    VALIDATION_STATUS.PASS,
  );
  const aiReviewItems = checks.flatMap((check) =>
    check.issues
      .filter((issue) => issue.requiresAiReview === true)
      .map((issue) => ({
        checkId: check.id,
        category: check.category,
        status: issue.status,
        reviewReason: issue.reviewReason,
        fingerprint: issue.fingerprint ?? issueFingerprint(issue),
        metric: issue.metric ?? null,
        organizationOid: issue.organizationOid ?? null,
        organizationName: issue.organizationName ?? null,
        field: issue.field ?? null,
        expected: issue.expected ?? null,
        actual: issue.actual ?? issue.value ?? null,
      })),
  );

  return {
    schemaVersion: 1,
    baselineVersion: input.indicatorRegistry?.baselineVersion ?? null,
    dataDate: reporting.latestObservedDate,
    reportingPeriod: {
      latestFullMonth: reporting.latestFullMonth.label,
      previousFullMonth: reporting.previousFullMonth.label,
      hasPartialNewerMonth: reporting.hasPartialNewerMonth,
      latestObservedDate: reporting.latestObservedDate,
    },
    overallStatus,
    summary: {
      checks: checks.length,
      ...counts,
      blocking: checks.filter((check) => check.blocking).length,
      aiReviewItems: aiReviewItems.length,
    },
    acknowledgedBaseline: input.baselineSnapshot?.acknowledgedCounts ?? {},
    checks,
    aiReviewItems,
  };
}

export function createAiReviewQueue(report) {
  return {
    schemaVersion: 1,
    baselineVersion: report.baselineVersion,
    dataDate: report.dataDate,
    sourceOverallStatus: report.overallStatus,
    reviewCount: report.aiReviewItems.length,
    rule: "AI receives only FAIL items, new anomalies and methodological conflicts; PASS and ordinary WARNING items are excluded.",
    items: report.aiReviewItems,
  };
}
