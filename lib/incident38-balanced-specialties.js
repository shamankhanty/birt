/**
 * Управленческая оценка доступности записи по И‑38, не официальный показатель.
 *
 * Для каждой специальности с положительным нормативом засчитываем не больше
 * target × норматив. Избыток слотов одного профиля не компенсирует дефицит другого.
 * Специальности без норматива не входят ни в числитель, ни в знаменатель.
 *
 * Пропуски данных (null/undefined), отрицательные и нечисловые значения не
 * превращаются в нули: в этих случаях оценка недоступна (null).
 */
export const BALANCED_SPECIALTY_TARGET = 0.70;

export function balancedSpecialties(rows, target = BALANCED_SPECIALTY_TARGET) {
  if (!Array.isArray(rows) || !Number.isFinite(target) || target <= 0 || target > 1) {
    return { attainment: null, cappedSlots: null, targetSlots: null, eligibleCount: 0, reachedCount: 0, zeroSlotCount: 0, excessSlots: null, excludedNormlessSlots: null };
  }
  if (rows.some(row => row == null || !Number.isFinite(row.norm) || !Number.isFinite(row.epguSlots) || row.norm < 0 || row.epguSlots < 0)) {
    return { attainment: null, cappedSlots: null, targetSlots: null, eligibleCount: 0, reachedCount: 0, zeroSlotCount: 0, excessSlots: null, excludedNormlessSlots: null };
  }
  const eligible = rows.filter(row => row.norm > 0);
  if (eligible.length === 0) {
    return { attainment: null, cappedSlots: null, targetSlots: null, eligibleCount: 0, reachedCount: 0, zeroSlotCount: 0, excessSlots: null, excludedNormlessSlots: rows.filter(row => row.norm === 0 && row.epguSlots > 0).length };
  }
  const targetSlots = eligible.reduce((sum, row) => sum + target * row.norm, 0);
  const cappedSlots = eligible.reduce((sum, row) => sum + Math.min(row.epguSlots, target * row.norm), 0);
  const excessSlots = eligible.reduce((sum, row) => sum + Math.max(0, row.epguSlots - target * row.norm), 0);
  const reachedCount = eligible.filter(row => row.epguSlots + 1e-9 >= target * row.norm).length;
  return {
    attainment: cappedSlots / targetSlots * 100,
    cappedSlots,
    targetSlots,
    eligibleCount: eligible.length,
    reachedCount,
    zeroSlotCount: eligible.filter(row => row.epguSlots === 0).length,
    excessSlots,
    excludedNormlessSlots: rows.filter(row => row.norm === 0 && row.epguSlots > 0).length,
  };
}
