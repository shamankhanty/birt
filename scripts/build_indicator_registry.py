#!/usr/bin/env python3
"""Build an indicator-registry candidate from source metadata.

Stage-6 rule: config/indicator-registry.json is canonical runtime metadata and
must not be silently regenerated during a weekly data refresh.  By default
this script writes validation/indicator-registry-candidate.json for review.
Use --write-canonical only for an explicitly approved methodology/metadata
change.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
PAGE = (APP / "page.tsx").read_text(encoding="utf-8")
CANONICAL = json.loads((ROOT / "config" / "indicator-registry.json").read_text(encoding="utf-8"))
CANONICAL_INDICATORS = CANONICAL.get("indicators", {})


def load(name: str) -> Any:
    return json.loads((APP / name).read_text(encoding="utf-8"))


def top_level_objects(text: str) -> list[str]:
    objects: list[str] = []
    depth = 0
    start = None
    quote = None
    escaped = False
    for i, ch in enumerate(text):
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in ('"', "'", "`"):
            quote = ch
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(text[start : i + 1])
                start = None
    return objects


def js_string(obj: str, key: str) -> str | None:
    m = re.search(rf"\b{re.escape(key)}:\s*\"((?:\\.|[^\"\\])*)\"", obj, re.S)
    if not m:
        return None
    return json.loads('"' + m.group(1) + '"')


def js_number(obj: str, key: str) -> float | int | None:
    m = re.search(rf"\b{re.escape(key)}:\s*(-?\d+(?:\.\d+)?)", obj)
    if not m:
        return None
    value = float(m.group(1))
    return int(value) if value.is_integer() else value


def js_bool(obj: str, key: str) -> bool | None:
    m = re.search(rf"\b{re.escape(key)}:\s*(true|false)", obj)
    return None if not m else m.group(1) == "true"


def array_body(marker: str) -> str:
    start = PAGE.index(marker)
    equals = PAGE.index("=", start)
    open_bracket = PAGE.index("[", equals)
    depth = 0
    quote = None
    escaped = False
    for i in range(open_bracket, len(PAGE)):
        ch = PAGE[i]
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in ('"', "'", "`"):
            quote = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return PAGE[open_bracket + 1 : i]
    raise RuntimeError(f"Unclosed array for {marker}")


static_indicators: dict[str, dict[str, Any]] = {}
for obj in top_level_objects(array_body("const baselineIndicators: Indicator[] =")):
    ident = js_string(obj, "id")
    if not ident:
        continue
    static_indicators[ident] = {
        "name": js_string(obj, "name"),
        "group": js_string(obj, "group"),
        "plan": js_number(obj, "plan"),
        "unit": js_string(obj, "unit"),
        "fact": js_number(obj, "fact"),
        "date": js_string(obj, "date"),
        "direction": "lower" if js_bool(obj, "reverse") else "higher",
        "planPeriod": js_string(obj, "planPeriod"),
    }

methodologies: dict[str, dict[str, Any]] = {}
for obj in top_level_objects(array_body("const methodologies: Methodology[] =")):
    ident = js_string(obj, "id")
    if not ident:
        continue
    methodologies[ident] = {
        key: js_string(obj, key)
        for key in ["name", "formula", "numerator", "denominator", "source", "cadence", "note", "legal"]
        if js_string(obj, key) is not None
    }

mo_data = load("mo-data.json")
operational = load("operational-mo.json")
org_status = load("organization-status.json")
monthly = load("monthly-mo.json")
physician_raw = load("physician-metrics.json")
physician = physician_raw["datasets"]

# page.tsx adds these cumulative TVSP datasets to monthlyMoData at runtime.
monthly_runtime_ids = set(monthly) | {"tvspStationary", "tvspAmbulatory", "tvspDiagnostic"}
explicit_rating_exclusions = {"errors", "tvspLaboratory", "egpu2days", "egpu", "birth"}
hearing_priority_exclusions = {
    "egpu",
    "egpu2days",
    "birth",
    "errors",
    "tmkMaxCount",
    "elnMaxCount",
    "hospitalCount",
    "fapSemdCount",
    "shortInput",
    "shortInputAmb",
    "shortInputHosp",
}


def current_label(metric_id: str) -> str | None:
    if metric_id in monthly:
        return monthly[metric_id].get("currentLabel")
    if metric_id in {"tvspStationary", "tvspAmbulatory", "tvspDiagnostic"}:
        ds = mo_data[metric_id]
        return f"На {ds.get('date')}" if ds.get("date") else "На 31.08"
    return None


def active_in_august_rating(metric_id: str, ds: dict[str, Any] | None) -> bool:
    if metric_id not in monthly_runtime_ids or metric_id in explicit_rating_exclusions:
        return False
    if not ds or ds.get("plan") is None:
        return False
    unit = (monthly.get(metric_id) or {}).get("unit")
    if metric_id in {"tvspStationary", "tvspAmbulatory", "tvspDiagnostic"}:
        unit = "%"
    if unit != "%":
        return False
    return bool(re.search(r"Август|31\.08|28\.08|29\.08", current_label(metric_id) or ""))


def rating_block(metric_id: str) -> str:
    if metric_id in {"semd228", "hospital", "ambulatoryCase", "smp"}:
        return "care"
    if metric_id in {"egpu", "egpu2days", "birth", "death"}:
        return "services"
    return "readiness"


def period_kind(metric_id: str, ds: dict[str, Any] | None, methodology: dict[str, Any] | None) -> str:
    if metric_id in physician:
        return "monthly"
    if metric_id in {"tmkMax", "elnMax", "visitMax"}:
        return "operational"
    cadence = (methodology or {}).get("cadence", "").lower()
    period = (ds or {}).get("period", "").lower()
    if "накоп" in cadence or period.startswith("01.01") or "январь–" in period:
        return "cumulative"
    if "ежемесяч" in cadence or re.search(r"(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)", period):
        return "monthly"
    return "snapshot"


def source_dataset(metric_id: str) -> tuple[str | None, dict[str, Any] | None]:
    if metric_id in mo_data:
        return "app/mo-data.json", mo_data[metric_id]
    if metric_id in operational:
        return "app/operational-mo.json", operational[metric_id]
    if metric_id in org_status:
        return "app/organization-status.json", org_status[metric_id]
    if metric_id in physician:
        return "app/physician-metrics.json", physician[metric_id]
    return None, None

all_ids = sorted(
    set(static_indicators)
    | set(mo_data)
    | set(operational)
    | set(org_status)
    | set(physician)
)

manual_formula = {
    "doctorsAll": "Врачи с ≥1 СЭМД в РЭМД / работающие врачи по ФРМР × 100%",
    "doctorsLevel3": "Врачи МО III уровня с ≥1 СЭМД в РЭМД / работающие врачи МО III уровня по ФРМР × 100%",
}
for ident in physician:
    if ident.startswith("doctor500_"):
        manual_formula[ident] = "Врачи соответствующей специальности с >500 СЭМД / работающие врачи этой специальности по ФРМР × 100%"

registry: dict[str, Any] = {
    "schemaVersion": 2,
    "status": "active",
    "baselineVersion": "4.6.0",
    "baselineCommit": "c50be9e1a04b6aa0641e0dd791c2b9238caa15d1",
    "generatedFrom": [
        "app/page.tsx",
        "app/mo-data.json",
        "app/monthly-mo.json",
        "app/operational-mo.json",
        "app/organization-status.json",
        "app/physician-metrics.json",
    ],
    "runtimeIntegration": True,
    "rule": "Реестр является runtime-источником metadata показателей; изменения требуют отдельного подтверждения.",
    "activatedAtStage": "stage6_indicator_metadata_runtime",
    "rating": {
        "blocks": {"care": 0.7, "services": 0.2, "readiness": 0.1},
        "baselinePeriod": "август 2026",
        "missingDataRule": "Отсутствие строки не заменяется нулём; показатель остаётся в контроле полноты, но не искажает балл.",
    },
    "globalExclusions": [
        "Неприменимый к МО показатель исключается из знаменателя рейтинга.",
        "Частные и технические организации исключаются из управленческих списков отстающих, если не дано отдельное указание.",
        "Случаи краткого ввода показываются справочно и не влияют на рейтинг/приоритет заслушивания.",
    ],
    "indicators": {},
}

for ident in all_ids:
    data_file, ds = source_dataset(ident)
    static = static_indicators.get(ident, {})
    method = methodologies.get(ident, {})
    name = (ds or {}).get("name") or static.get("name") or method.get("name") or ident
    canonical_item = CANONICAL_INDICATORS.get(ident, {})
    plan = (ds or {}).get("plan") if ds and "plan" in ds else canonical_item.get("plan", {}).get("value")
    direction = (ds or {}).get("direction") or canonical_item.get("direction") or "higher"
    unit = (ds or {}).get("unit") if ds else static.get("unit")
    period = (ds or {}).get("period") if ds else None
    if ident in physician:
        period = physician[ident].get("period") or physician_raw.get("period")
    date = (ds or {}).get("date") if ds else static.get("date")
    active = active_in_august_rating(ident, ds)

    if active:
        rating_policy = "include"
        rating_reason = "Активен в августовском рейтинге v4.6.0."
    elif ident in explicit_rating_exclusions:
        rating_policy = "exclude"
        rating_reason = "Явно исключён из buildOrganizationRating() в baseline v4.6.0."
    elif ident == "ambulatoryCase":
        rating_policy = "conditional"
        rating_reason = "Нет сопоставимого полного августовского набора по МО; вернуть после появления август/июль."
    elif ident.startswith("shortInput"):
        rating_policy = "exclude"
        rating_reason = "Справочный показатель; без баллов и приоритета заслушивания."
    elif ident in monthly_runtime_ids:
        rating_policy = "conditional"
        rating_reason = "Набор присутствует в помесячном контуре, но не проходит текущие условия включения baseline v4.6.0."
    else:
        rating_policy = "not_applicable"
        rating_reason = "Не входит в текущий помесячный контур интегрального рейтинга v4.6.0."

    formula = method.get("formula") or manual_formula.get(ident)
    if not formula:
        mode = (ds or {}).get("mode")
        if mode == "presence":
            formula = "Количество МО, соответствующих критерию / количество применимых МО × 100%"
        elif (ds or {}).get("unit") == "%":
            formula = "Числитель / знаменатель × 100% согласно текущему источнику v4.6.0"
        else:
            formula = "Абсолютное значение из утверждённого источника v4.6.0"

    exclusions: list[str] = []
    if ident == "semd228":
        exclusions.append("Одна несопоставленная частная строка из Ижевска со знаменателем 1 исключена и сохранена в аудите.")
    if ident in {"tmkMaxCount", "elnMaxCount", "tmkMax", "elnMax"}:
        exclusions.append("РКПД/противотуберкулёзный профиль учитывает специальные правила применимости МАХ в текущем runtime.")
    if ident.startswith("doctor500_"):
        exclusions.append("При знаменателе 1–2 врача результат справочный для приоритета заслушивания.")

    hearing_priority = ident not in hearing_priority_exclusions
    row_exclusion_rules: list[str] = []
    if ident in {"tmkMaxCount", "elnMaxCount"}:
        row_exclusion_rules.append("max_profile_inapplicable")
    if ident.startswith("doctor500_"):
        row_exclusion_rules.append("small_denominator_lt3_reference_only")

    registry["indicators"][ident] = {
        "name": name,
        "group": static.get("group"),
        "formula": formula,
        "numerator": method.get("numerator"),
        "denominator": method.get("denominator"),
        "source": {
            "dataFile": data_file,
            "methodology": method.get("source"),
        },
        "period": {
            "kind": period_kind(ident, ds, method),
            "current": period,
            "date": date,
            "comparisonLabel": current_label(ident),
            "cadence": method.get("cadence"),
        },
        "plan": {
            "value": plan,
            "period": canonical_item.get("plan", {}).get("period"),
        },
        "direction": direction,
        "unit": unit,
        "rating": {
            "policy": rating_policy,
            "baselineActive": active,
            "block": rating_block(ident),
            "reason": rating_reason,
        },
        "exclusions": exclusions,
        "management": {
            "hearingPriority": hearing_priority,
            "reason": (
                "При наличии применимости, данных и плана может участвовать в приоритете заслушивания."
                if hearing_priority
                else "Исключён из приоритета заслушивания в baseline v4.6.0."
            ),
        },
        "rowExclusionRules": row_exclusion_rules,
        "baselineStaticFact": static.get("fact"),
        "notes": method.get("note"),
        "legal": method.get("legal"),
    }

parser = argparse.ArgumentParser()
parser.add_argument(
    "--write-canonical",
    action="store_true",
    help="Explicitly overwrite config/indicator-registry.json after approved metadata/methodology change.",
)
args = parser.parse_args()

out = (
    ROOT / "config" / "indicator-registry.json"
    if args.write_canonical
    else ROOT / "validation" / "indicator-registry-candidate.json"
)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
mode = "CANONICAL WRITE" if args.write_canonical else "candidate only"
print(f"{mode}: wrote {out.relative_to(ROOT)} with {len(registry['indicators'])} indicators")
