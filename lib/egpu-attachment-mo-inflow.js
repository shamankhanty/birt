import { estimateAttachmentInflow } from "./egpu-attachment-inflow.js";

/**
 * Сопоставление двух утверждённых накопительных отчётов по неизменному OID МО.
 * Единый знаменатель применяется к двум показателям ЕПГУ, не суммируется.
 * Несовпадающий период/периметр и отсутствие данных не превращаются в 0.
 */
export function buildAttachmentMoInflow(dataset, snapshots) {
  const aggregate = estimateAttachmentInflow(dataset);
  if (!aggregate || !snapshots?.previous || !snapshots?.current) return null;
  if (snapshots.previous.date !== aggregate.previousDate ||
      snapshots.current.date !== aggregate.currentDate ||
      snapshots.previous.period !== dataset.previousPeriod ||
      snapshots.current.period !== dataset.period ||
      snapshots.previous.total !== aggregate.previousTotal ||
      snapshots.current.total !== aggregate.currentTotal) return null;

  const oldEntries = Object.entries(snapshots.previous.byOid ?? {});
  const newEntries = Object.entries(snapshots.current.byOid ?? {});
  const oldKeys = oldEntries.map(([oid]) => oid).sort();
  const newKeys = newEntries.map(([oid]) => oid).sort();
  if (oldKeys.length === 0 || oldKeys.length !== newKeys.length ||
      oldKeys.some((oid, index) => oid !== newKeys[index])) return null;
  const all = [...oldEntries, ...newEntries];
  if (all.some(([oid, value]) => !oid || !Number.isSafeInteger(value) || value < 0)) return null;

  const sum = (entries) => entries.reduce((total, [, value]) => total + value, 0);
  if (sum(oldEntries) !== aggregate.previousTotal ||
      sum(newEntries) !== aggregate.currentTotal) return null;

  const byOid = {};
  let totalDelta = 0;
  for (const [oid, oldVolume] of oldEntries) {
    const currentVolume = snapshots.current.byOid[oid];
    const delta = currentVolume - oldVolume;
    byOid[oid] = { previous: oldVolume, current: currentVolume, delta };
    totalDelta += delta;
  }
  if (totalDelta !== aggregate.count) return null;

  return {
    previousDate: aggregate.previousDate,
    currentDate: aggregate.currentDate,
    count: aggregate.count,
    organizations: oldEntries.length,
    byOid,
  };
}
