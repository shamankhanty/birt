"""Non-authoritative OID reconciliation of 500+ physician summaries.

The official result comes from "Врачи по спец-тям_По МО". Detail rows
are diagnostic only: FRMR headcount, position eligibility and REMD
signature rows are not guaranteed to describe the same population.
"""
from collections import defaultdict


def _position_metric(value):
    position = str(value or "").strip().lower().replace("ё", "е")
    if not position.startswith("врач"):
        return None
    if "стоматолог" in position:
        return "doctor500_dentist"
    if "акушер-гинеколог" in position:
        return "doctor500_obgyn"
    if "общей практики" in position:
        return "doctor500_gp"
    for part, metric in (
        ("кардиолог", "doctor500_cardiologist"),
        ("онколог", "doctor500_oncologist"),
        ("офтальмолог", "doctor500_ophthalmologist"),
        ("педиатр", "doctor500_pediatrician"),
        ("терапевт", "doctor500_therapist"),
        ("хирург", "doctor500_surgeon"),
    ):
        if part in position:
            return metric
    return None


def reconcile_physician500_detail(detail_rows, datasets):
    """Mark disagreements without replacing any federally summarized facts.

    Input detail columns are the published 2026 layout:
    B MO OID, I worker OID, J FRMR position, M registered SEMD.
    The supplemental calculation groups per (MO, speciality, worker OID),
    sums their rows and counts totals strictly greater than 500.
    This is a quality signal, NOT an alternative approved numerator.
    """
    counts = defaultdict(lambda: defaultdict(int))
    skipped = 0
    if detail_rows is not None:
        for row in detail_rows:
            if len(row) < 13 or row[0] != "Республика Татарстан":
                continue
            metric = _position_metric(row[9])
            if metric not in datasets or not row[1] or not row[8]:
                continue
            try:
                raw = float(row[12] or 0)
            except (ValueError, TypeError):
                skipped += 1
                continue
            if raw < 0 or not raw.is_integer():
                skipped += 1
                continue
            counts[(str(row[1]), metric)][str(row[8])] += int(raw)

    results = {"compared": 0, "warnings": 0, "unavailable": 0, "skippedDetailRows": skipped}
    for metric, rows in datasets.items():
        if not metric.startswith("doctor500_"):
            continue
        for item in rows:
            workers = counts.get((item["oid"], metric))
            if workers is None:
                status = "UNAVAILABLE"
                detail_count = detail_volume = None
                results["unavailable"] += 1
            else:
                detail_volume = len(workers)
                detail_count = sum(total > 500 for total in workers.values())
                results["compared"] += 1
                status = (
                    "MATCH" if detail_count == item["count"] and detail_volume == item["volume"]
                    else "WARN"
                )
                if status == "WARN":
                    results["warnings"] += 1
            item["detailReconciliation"] = {
                "status": status,
                "sourceCount": item["count"],
                "sourceVolume": item["volume"],
                "detailCount": detail_count,
                "detailVolume": detail_volume,
                "basis": "Справочная сверка ФРМР-должностей и OID работников; не замена официального свода",
            }
            if status != "MATCH":
                detail_text = (
                    f"детализация по OID {detail_count}/{detail_volume}"
                    if workers is not None else "строки детализации не определены"
                )
                warning = (
                    f"Требуется сверка 500+: свод {item['count']}/{item['volume']}, "
                    f"{detail_text}. Различия могут быть связаны с составом ФРМР, "
                    "должностями и правилами учёта. Факт из сводного листа сохранён."
                )
                item["sourceWarning"] = " ".join(
                    part for part in (item.get("sourceWarning"), warning) if part
                )
    return results
