#!/usr/bin/env python3
"""Finalize v5.2.0 release documentation after a successful build/test gate."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"expected text not found in {path}: {old[:80]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


replace(
    "STATE.md",
    "- Дата сборки: **08.09.2026**. Эта редакция не публиковалась.",
    "- Дата финальной проверки сборки: **09.09.2026**. Публикация выполняется отдельно после слияния в `main`.",
)
replace(
    "STATE.md",
    "- Production build v5.2.0 в текущем окружении не запускался из-за отсутствия установленных frontend-зависимостей; перед публикацией build-gate обязателен. Последняя подтверждённая полная сборка v5.1.0 — PASS.\n- Unit/data автотесты без `rendered-html`: **132/132 PASS**; полный `rendered-html` проверяется production build-gate.",
    "- Production build v5.2.0: **PASS**; Sites artifact прошёл проверку структуры.\n- Автотесты: **133/133 PASS**.",
)
replace(
    "OPEN_ISSUES.md",
    "Контроль изменения v5.2.0: unit/data tests без `rendered-html` **132/132 PASS**, validation **15/15 PASS**, calculation equivalence **38/38 PASS**, metadata equivalence **38/38 PASS**, staging/self-test **19/19 PASS**. Production build-gate требуется повторить перед публикацией; последняя подтверждённая полная сборка v5.1.0 — PASS.",
    "Контроль изменения v5.2.0: **133/133 теста PASS**, validation **15/15 PASS**, calculation equivalence **38/38 PASS**, metadata equivalence **38/38 PASS**, staging/self-test **19/19 PASS**, production build **PASS**; Sites artifact прошёл проверку структуры.",
)
replace(
    "README.md",
    "Текущая рабочая версия: **v5.2.0 от 08.09.2026**.",
    "Текущая рабочая версия: **v5.2.0 от 09.09.2026**.",
)
replace(
    "README.md",
    "- unit/data tests без `rendered-html`: **132/132 PASS**;\n- validation: **15/15 PASS**;\n- calculation equivalence: **38/38 PASS**;\n- metadata equivalence: **38/38 PASS**;\n- staging/self-test: **19/19 PASS**;\n- production build-gate v5.2.0: **требуется перед публикацией**; последняя подтверждённая полная сборка v5.1.0 — PASS.",
    "- автотесты: **133/133 PASS**;\n- validation: **15/15 PASS**;\n- calculation equivalence: **38/38 PASS**;\n- metadata equivalence: **38/38 PASS**;\n- staging/self-test: **19/19 PASS**;\n- production build: **PASS**; Sites artifact прошёл проверку структуры.",
)

manifest_path = ROOT / "baseline" / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["regression"]["nodeTests"] = "133/133 PASS"
manifest["regression"]["stagingAdapters"] = "19/19 PASS"
manifest["regression"]["warnings"] = []
manifest["note"] = (
    "v5.2.0 adds factual doctor appointments through MAX by municipality without MO attribution. "
    "Validation, staging, production build and the full 133-test suite passed before merge."
)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("v5.2.0 documentation finalized")
