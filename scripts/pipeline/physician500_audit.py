"""Conservative source-to-detail audit for the physician 500+ indicators.

The approved fact is read from ``Врачи по спец-тям_По МО``. The worker
detail is a quality-control source only: it contains aggregated counts per
worker/position/unit but no document identifiers. Therefore this module
never sums rows to replace the approved fact. It reports a single-row value
and a summed-row diagnostic value and marks ambiguity as WARN.
"""
from __future__ import annotations

from collections import defaultdict


POSITION_TO_METRIC = {
    "врач-акушер-гинеколог": "doctor500_obgyn",
    "врач общей практики (семейный врач)": "doctor500_gp",
    "врач-кардиолог": "doctor500_cardiologist",
    "врач-онколог": "doctor500_oncologist",
    "врач-офтальмолог": "doctor500_ophthalmologist",
    "врач-педиатр": "doctor500_pediatrician",
    "врач-педиатр городской (районный)": "doctor500_pediatrician",
    "врач-педиатр участковый": "doctor500_pediatrician",
    "врач-стоматолог": "doctor500_dentist",
    "врач-стоматолог детский": "doctor500_dentist",
    "врач-стоматолог-терапевт": "doctor500_dentist",
    "врач-терапевт": "doctor500_therapist",
    "врач-терапевт подростковый": "doctor500_therapist",
    "врач-терапевт участковый": "doctor500_therapist",
    "врач-терапевт участковый цехового врачебного участка": "doctor500_therapist",
    "врач-хирург": "doctor500_surgeon",
}


def _normalise_position(value):
    return " ".join(str(value or "").strip().lower().replace("ё", "е").split())


def _position_metric(value):
    """Use an explicit role allow-list; similar subspecialties are not merged."""
    return POSITION_TO_METRIC.get(_normalise_position(value))


def _safe_amount(value):
    try:
        amount = float(value or 0)
    except (ValueError, TypeError):
        return None
    if amount < 0 or not amount.is_integer():
        return None
    return int(amount)


def reconcile_physician500_detail(detail_rows, datasets):
    """Attach a non-authoritative OID audit to every source summary row.

    Detail columns in the 2026 workbook are: B MO OID, I worker OID,
    J FRMR position, K signature position, L unit type and M SEMD count.
    A worker is unique inside an MO by OID. ``detailCountNoSum`` counts a
    worker only when one eligible row independently exceeds 500. The summed
    value is retained solely to expose threshold ambiguity.
    """
    workers = defaultdict(lambda: defaultdict(list))
    skipped = 0
    detail_available = detail_rows is not None
    if detail_rows is not None:
        for source_row, row in enumerate(detail_rows, start=8):
            if len(row) < 13 or row[0] != "Республика Татарстан":
                continue
            metric = _position_metric(row[9])
            if metric not in datasets or not row[1] or not row[8]:
                continue
            amount = _safe_amount(row[12])
            if amount is None:
                skipped += 1
                continue
            workers[(str(row[1]), metric)][str(row[8])].append({
                "sourceRow": source_row,
                "amount": amount,
                "frmrPosition": str(row[9] or ""),
                "signaturePosition": str(row[10] or ""),
                "unitType": str(row[11] or ""),
            })

    result = {
        "statusSummary": {"PASS": 0, "WARN": 0, "FAIL": 0},
        "compared": 0,
        "unavailable": 0,
        "skippedDetailRows": skipped,
        "issues": [],
    }
    for metric, rows in datasets.items():
        if not metric.startswith("doctor500_"):
            continue
        for item in rows:
            grouped = workers.get((str(item["oid"]), metric))
            source_count = item["count"]
            source_volume = item["volume"]
            if not detail_available or grouped is None:
                audit = {
                    "status": "WARN",
                    "reasonCode": "DETAIL_UNAVAILABLE",
                    "sourceCount": source_count,
                    "sourceVolume": source_volume,
                    "detailCountNoSum": None,
                    "detailCountSummed": None,
                    "detailVolume": None,
                    "thresholdAmbiguousWorkers": 0,
                    "basis": "Нет строк детализации; отсутствие не заменено нулём",
                }
                result["unavailable"] += 1
            else:
                detail_volume = len(grouped)
                no_sum = sum(any(r["amount"] > 500 for r in values) for values in grouped.values())
                summed = sum(sum(r["amount"] for r in values) > 500 for values in grouped.values())
                ambiguous = [
                    oid for oid, values in grouped.items()
                    if not any(r["amount"] > 500 for r in values)
                    and sum(r["amount"] for r in values) > 500
                ]
                matches = detail_volume == source_volume and no_sum == source_count and not ambiguous
                audit = {
                    "status": "PASS" if matches else "WARN",
                    "reasonCode": "DETAIL_CONFIRMED" if matches else "DETAIL_SCOPE_OR_SUM_AMBIGUOUS",
                    "sourceCount": source_count,
                    "sourceVolume": source_volume,
                    "detailCountNoSum": no_sum,
                    "detailCountSummed": summed,
                    "detailVolume": detail_volume,
                    "thresholdAmbiguousWorkers": len(ambiguous),
                    "basis": (
                        "OID работника + точный перечень должностей; порог строго свыше 500; строки не суммировались"
                        if matches else
                        "Детализация не подтверждает состав свода без дополнительных правил ФРМР или идентификаторов СЭМД"
                    ),
                }
                result["compared"] += 1

            item["detailReconciliation"] = audit
            result["statusSummary"][audit["status"]] += 1
            if audit["status"] != "PASS":
                issue = {
                    "medicalOrganization": item.get("name"),
                    "moOid": item.get("oid"),
                    "specialty": metric,
                    **audit,
                    "numeratorDeltaNoSum": None if audit["detailCountNoSum"] is None else audit["detailCountNoSum"] - source_count,
                    "denominatorDelta": None if audit["detailVolume"] is None else audit["detailVolume"] - source_volume,
                }
                result["issues"].append(issue)
                detail_text = (
                    "сверка по детализации недоступна"
                    if audit["detailCountNoSum"] is None else
                    f"детализация без суммирования {audit['detailCountNoSum']}/{audit['detailVolume']}"
                )
                warning = (
                    f"Проверка 500+: свод {source_count}/{source_volume}, {detail_text}. "
                    "Официальный факт сохранён; требуется уточнение состава ФРМР или первичных идентификаторов СЭМД."
                )
                item["sourceWarning"] = " ".join(
                    part for part in (item.get("sourceWarning"), warning) if part
                )
    return result
