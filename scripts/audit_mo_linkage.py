#!/usr/bin/env python3
"""Fail the build when MO facts and quantitative components are not linked."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LEGAL = re.compile(r"^(?:филиал\s+)?(?:гауз|гбуз|гбу|фгбу|фгауз|фгаоуво|фгаоу\s*во|ао|ооо)(?:\s+рт)?\s*", re.I)


def key(value: object) -> str:
    text = str(value or "").strip().lower().replace("ё", "е")
    text = LEGAL.sub("", text).replace("«", "").replace("»", "").replace('"', "")
    replacements = (
        (r"детская\s+городская\s+клиническая\s+больница|городская\s+детская\s+клиническая\s+больница", "дгкб"),
        (r"детская\s+городская\s+поликлиника|городская\s+детская\s+поликлиника", "дгп"),
        (r"детская\s+гп", "дгп"),
        (r"городская\s+клиническая\s+больница", "гкб"),
        (r"городская\s+поликлиника", "гп"),
        (r"центральная\s+районная\s+больница", "црб"),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"\s+г\.?\s*казани\b", " казань", text)
    text = re.sub(r"\s*№\s*", " №", text)
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text)
    return re.sub(r"[^a-zа-я0-9№]+", " ", text).strip()


def load(name: str):
    return json.loads((ROOT / "app" / name).read_text(encoding="utf-8"))


def main() -> None:
    datasets = {**load("mo-data.json"), **load("operational-mo.json"), **load("organization-status.json")}
    details = load("mo-details.json")
    detail_oids = load("mo-detail-oids.json")
    errors: list[str] = []
    checked = 0

    for metric, dataset in datasets.items():
        if dataset.get("mode") == "presence":
            seen_oids: dict[str, str] = {}
            for row in dataset.get("rows", []):
                checked += 1
                oid = str(row.get("oid") or "").strip()
                if not oid:
                    errors.append(f"{metric}: отсутствует OID для плановой МО {row.get('name')!r}")
                    continue
                previous_name = seen_oids.get(oid)
                if previous_name and key(previous_name) != key(row.get("name")):
                    errors.append(f"{metric}: OID {oid} связан с двумя МО: {previous_name!r} и {row.get('name')!r}")
                seen_oids[oid] = str(row.get("name") or "")
            continue
        if dataset.get("mode") == "count":
            continue
        metric_details = details.get(metric, {})
        normalized: dict[str, list[dict]] = {}
        for detail_key, detail in metric_details.items():
            normalized.setdefault(key(detail_key), []).append(detail)
        seen_oids: dict[str, str] = {}
        for row in dataset.get("rows", []):
            checked += 1
            name = row.get("name", "")
            source_warning = str(row.get("sourceWarning") or "").lower()
            if source_warning.startswith(("нет строки в исходном перечне", "нет строки в выгрузке")):
                # Управленческий справочник может содержать применимую МО,
                # которой нет в текущем исходнике. Такая строка должна явно
                # показываться как «Нет данных», а не подменяться нулём.
                continue
            if re.match(r"^(?:ООО|АО|ЧУЗ)\b", str(name), re.I):
                continue
            oid = str(row.get("oid") or "").strip()
            if oid:
                previous_name = seen_oids.get(oid)
                if previous_name and key(previous_name) != key(name):
                    errors.append(f"{metric}: OID {oid} связан с двумя МО: {previous_name!r} и {name!r}")
                seen_oids[oid] = name

            detail = detail_oids.get(metric, {}).get(oid) if oid else None
            if detail is None:
                matches = normalized.get(key(name), [])
                if len(matches) == 1:
                    detail = matches[0]
                elif len(matches) > 1:
                    errors.append(f"{metric}: неоднозначное сопоставление количеств для {name!r}")
                    continue

            count = row.get("count")
            fact = row.get("fact")
            if detail is None and isinstance(count, (int, float)) and isinstance(fact, (int, float)) and fact > 0:
                detail = {"registered": count, "volume": round(count * 100 / fact)}
            if detail is None:
                errors.append(f"{metric}: нет числителя/знаменателя для {name!r}")
                continue

            numerator = detail.get("registered")
            denominator = detail.get("volume")
            if not isinstance(numerator, (int, float)) or not isinstance(denominator, (int, float)) or denominator <= 0:
                errors.append(f"{metric}: некорректные компоненты для {name!r}: {numerator}/{denominator}")
                continue
            calculated = numerator / denominator * 100
            if not isinstance(fact, (int, float)) or not math.isclose(calculated, fact, abs_tol=0.015):
                errors.append(f"{metric}: факт {fact} не равен {numerator}/{denominator}={calculated:.4f}% для {name!r}")

    if errors:
        print("MO linkage audit failed:")
        print("\n".join(f"- {message}" for message in errors[:100]))
        raise SystemExit(1)
    print(f"MO linkage audit passed: {checked} строк проверено")


if __name__ == "__main__":
    main()
