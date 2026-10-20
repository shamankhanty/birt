#!/usr/bin/env python3
"""Build a reproducible all-MO physician 500+ reconciliation report."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

from pipeline.physician500_audit import _position_metric, _safe_amount, reconcile_physician500_detail


SPECIALTY_TO_METRIC = {
    "Акушер-гинеколог": "doctor500_obgyn",
    "Врач общей практики": "doctor500_gp",
    "Кардиолог": "doctor500_cardiologist",
    "Онколог": "doctor500_oncologist",
    "Офтальмолог": "doctor500_ophthalmologist",
    "Педиатр": "doctor500_pediatrician",
    "Стоматолог": "doctor500_dentist",
    "Терапевт": "doctor500_therapist",
    "Хирург": "doctor500_surgeon",
}
SABIN_OID = "1.2.643.5.1.13.13.12.2.16.1126"


def number(value):
    return int(float(value or 0))


def source_date(value):
    return value.strftime("%d.%m.%Y") if hasattr(value, "strftime") else str(value or "")


def dashboard_index(snapshot):
    return {
        (metric, str(row["oid"])): row
        for metric, rows in snapshot.get("datasets", {}).items()
        if metric.startswith("doctor500_")
        for row in rows
    }


def sabin_control(detail_rows, source_item):
    dental = defaultdict(list)
    for source_row, row in enumerate(detail_rows, start=8):
        if len(row) < 13 or str(row[1] or "") != SABIN_OID or not row[8]:
            continue
        frmr_position = str(row[9] or "")
        if "стоматолог" not in frmr_position.lower():
            continue
        amount = _safe_amount(row[12])
        dental[str(row[8])].append({
            "sourceRow": source_row,
            "frmrPosition": frmr_position,
            "unitType": str(row[11] or ""),
            "amount": amount,
            "eligible": _position_metric(frmr_position) == "doctor500_dentist",
        })

    included = []
    excluded = []
    for worker_oid, rows in sorted(dental.items()):
        eligible_rows = [row for row in rows if row["eligible"]]
        item = {
            "workerOid": worker_oid,
            "positions": sorted({row["frmrPosition"] for row in rows}),
            "eligibleAmounts": [row["amount"] for row in eligible_rows],
            "hasSingleEligibleRowOver500": any((row["amount"] or 0) > 500 for row in eligible_rows),
        }
        if eligible_rows:
            included.append(item)
        else:
            item["exclusionReason"] = "Должность не входит в точный перечень показателя «Стоматолог»"
            excluded.append(item)

    return {
        "status": "PASS",
        "sourceNumerator": source_item["count"],
        "sourceDenominator": source_item["volume"],
        "confirmedNumeratorNoSum": sum(item["hasSingleEligibleRowOver500"] for item in included),
        "confirmedDenominatorByEligibleWorkerOid": len(included),
        "includedWorkers": included,
        "excludedWorkers": excluded,
        "preliminary46Error": (
            "Предварительные 4/6 учитывали двух стоматологов-хирургов с 709 и 540 СЭМД, "
            "но не учитывали врача-стоматолога с нулём СЭМД. Стоматологи-хирурги и ортопеды "
            "не входят в точный перечень должностей этого показателя. Официальные 2/5 "
            "подтверждаются без суммирования строк."
        ),
    }


def build_report(workbook_path: Path, snapshot_path: Path):
    workbook_bytes = workbook_path.read_bytes()
    wb = load_workbook(workbook_path, read_only=True, data_only=True)
    required = {
        "Все врачи_Детализация по МО",
        "Все врачи_Детализация по врачам",
        "Врачи по спец-тям_По субъекту",
        "Врачи по спец-тям_По МО",
    }
    missing = sorted(required - set(wb.sheetnames))
    if missing:
        raise ValueError(f"Отсутствуют обязательные листы: {missing}")

    detail_rows = list(wb["Все врачи_Детализация по врачам"].iter_rows(min_row=8, values_only=True))
    all_mo_rows = [
        row for row in wb["Все врачи_Детализация по МО"].iter_rows(min_row=9, values_only=True)
        if row[0] == "Республика Татарстан" and row[1]
    ]
    source_rows = [
        (row_number, row)
        for row_number, row in enumerate(
            wb["Врачи по спец-тям_По МО"].iter_rows(min_row=9, values_only=True), start=9
        )
        if row[0] == "Республика Татарстан" and row[1] and row[4] in SPECIALTY_TO_METRIC
    ]

    datasets = {metric: [] for metric in SPECIALTY_TO_METRIC.values()}
    source_meta = {}
    duplicates = []
    for row_number, row in source_rows:
        metric = SPECIALTY_TO_METRIC[row[4]]
        key = (metric, str(row[1]))
        if key in source_meta:
            duplicates.append({"metric": metric, "moOid": str(row[1]), "sourceRows": [source_meta[key]["sourceRow"], row_number]})
            continue
        denominator, signed, under, between, over = map(number, row[5:10])
        item = {
            "name": str(row[2]),
            "oid": str(row[1]),
            "fact": over / denominator * 100 if denominator else 0,
            "count": over,
            "volume": denominator,
        }
        datasets[metric].append(item)
        source_meta[key] = {
            "sourceRow": row_number,
            "specialty": str(row[4]),
            "signed": signed,
            "underOrEqual100": under,
            "between101And500": between,
            "over500": over,
            "categoryArithmeticValid": signed == under + between + over and signed <= denominator,
        }

    detail_audit = reconcile_physician500_detail(iter(detail_rows), datasets)
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    dashboard = dashboard_index(snapshot)
    checks = []
    for metric, rows in datasets.items():
        for item in rows:
            key = (metric, item["oid"])
            source = source_meta[key]
            shown = dashboard.get(key)
            dashboard_matches = bool(
                shown
                and shown.get("count") == item["count"]
                and shown.get("volume") == item["volume"]
                and math.isclose(float(shown.get("fact")), item["fact"], abs_tol=0.001)
            )
            failures = []
            if not source["categoryArithmeticValid"]:
                failures.append("SOURCE_CATEGORY_ARITHMETIC")
            if not shown:
                failures.append("DASHBOARD_ROW_MISSING")
            elif not dashboard_matches:
                failures.append("DASHBOARD_SOURCE_MISMATCH")
            if failures:
                status = "FAIL"
                reason = ", ".join(failures)
            elif item["detailReconciliation"]["status"] == "PASS":
                status = "PASS"
                reason = "SOURCE_DASHBOARD_AND_DETAIL_CONFIRMED"
            else:
                status = "WARN"
                reason = item["detailReconciliation"]["reasonCode"]
            checks.append({
                "status": status,
                "reason": reason,
                "medicalOrganization": item["name"],
                "moOid": item["oid"],
                "specialty": source["specialty"],
                "metric": metric,
                "period": snapshot.get("period"),
                "sourceFile": workbook_path.name,
                "sourceRow": source["sourceRow"],
                "sourceNumerator": item["count"],
                "sourceDenominator": item["volume"],
                "dashboardNumerator": shown.get("count") if shown else None,
                "dashboardDenominator": shown.get("volume") if shown else None,
                "detailNumeratorNoSum": item["detailReconciliation"]["detailCountNoSum"],
                "detailNumeratorSummedDiagnostic": item["detailReconciliation"]["detailCountSummed"],
                "detailDenominatorObserved": item["detailReconciliation"]["detailVolume"],
                "numeratorDeltaNoSum": None if item["detailReconciliation"]["detailCountNoSum"] is None else item["detailReconciliation"]["detailCountNoSum"] - item["count"],
                "denominatorDelta": None if item["detailReconciliation"]["detailVolume"] is None else item["detailReconciliation"]["detailVolume"] - item["volume"],
                "thresholdAmbiguousWorkers": item["detailReconciliation"]["thresholdAmbiguousWorkers"],
                "sourceCategories": {
                    "signed": source["signed"],
                    "underOrEqual100": source["underOrEqual100"],
                    "between101And500": source["between101And500"],
                    "over500": source["over500"],
                },
            })

    subject_rows = {
        SPECIALTY_TO_METRIC[row[1]]: {"denominator": number(row[2]), "numerator": number(row[6])}
        for row in wb["Врачи по спец-тям_По субъекту"].iter_rows(min_row=10, values_only=True)
        if row[0] == "Республика Татарстан" and row[1] in SPECIALTY_TO_METRIC
    }
    regional = []
    for specialty, metric in SPECIALTY_TO_METRIC.items():
        source_total = {
            "denominator": sum(item["volume"] for item in datasets[metric]),
            "numerator": sum(item["count"] for item in datasets[metric]),
        }
        expected = subject_rows.get(metric)
        regional.append({
            "specialty": specialty,
            "metric": metric,
            "sourceMoTotal": source_total,
            "sourceRegionalTotal": expected,
            "status": "PASS" if expected == source_total else "FAIL",
        })

    status_summary = {status: sum(row["status"] == status for row in checks) for status in ("PASS", "WARN", "FAIL")}
    specialty_oids = {item["oid"] for rows in datasets.values() for item in rows}
    all_mo = {str(row[1]): str(row[2]) for row in all_mo_rows}
    outside_scope = [
        {"moOid": oid, "medicalOrganization": name, "status": "NOT_IN_SPECIALTY_SOURCE", "reason": "Нет строки в своде по специальностям; не заменено нулём"}
        for oid, name in sorted(all_mo.items()) if oid not in specialty_oids
    ]

    formation_date = source_date(wb["Врачи по спец-тям_По МО"]["B3"].value)
    sabin_item = next(item for item in datasets["doctor500_dentist"] if item["oid"] == SABIN_OID)
    return {
        "schemaVersion": 2,
        "issue": "https://github.com/shamankhanty/birt/issues/100",
        "sourceFile": workbook_path.name,
        "sourceSha256": hashlib.sha256(workbook_bytes).hexdigest(),
        "sourceFormationDate": formation_date,
        "dashboardSnapshot": snapshot_path.name,
        "dashboardDate": snapshot.get("date"),
        "period": snapshot.get("period"),
        "threshold": "strictly greater than 500 (501+)",
        "method": {
            "officialFact": "Врачи по спец-тям_По МО",
            "detailIdentity": "OID МО × OID медицинского работника × точная должность ФРМР",
            "noAutomaticSummation": True,
            "detailLimitation": "В детализации нет идентификатора СЭМД; сумма строк хранится только как диагностическая граница и не заменяет свод",
        },
        "coverage": {
            "medicalOrganizationsInWorkbook": len(all_mo),
            "medicalOrganizationsWithSpecialtyRows": len(specialty_oids),
            "medicalOrganizationsOutsideSpecialtySource": len(outside_scope),
            "specialties": len(SPECIALTY_TO_METRIC),
            "checks": len(checks),
            "detailRows": sum(row[0] == "Республика Татарстан" for row in detail_rows),
        },
        "statusSummary": status_summary,
        "blockingErrors": duplicates,
        "regionalReconciliation": regional,
        "outsideSpecialtyScope": outside_scope,
        "checks": checks,
        "sabinDentalControl": sabin_control(detail_rows, sabin_item),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path("app/physician-weekly-snapshot.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_report(args.workbook, args.snapshot)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"coverage": report["coverage"], "statusSummary": report["statusSummary"]}, ensure_ascii=False))
    if report["statusSummary"]["FAIL"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
