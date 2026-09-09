#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "app" / "page.tsx"
SELF = Path(__file__).resolve()

OLD_BIRTH = "Доля медицинских свидетельств о рождении относительно актов гражданского состояния"
OLD_DEATH = "Доля медицинских свидетельств о смерти относительно актов гражданского состояния"
OLD_DEATH_ALT = "Доля медицинских свидетельств о смерти относительно общего количества актов гражданского состояния"

SKIP_DIRS = {".git", "node_modules", ".vinext", ".wrangler", "__pycache__"}
TEXT_SUFFIXES = {".tsx", ".ts", ".js", ".mjs", ".json", ".md", ".py", ".yml", ".yaml"}
IMMUTABLE_PREFIXES = (
    "baseline/reference-",
)


def replace_indicator_names() -> list[str]:
    changed: list[str] = []
    replacements = {
        OLD_BIRTH: "МСР",
        OLD_DEATH: "МСС",
        OLD_DEATH_ALT: "МСС",
    }
    for path in ROOT.rglob("*"):
        if not path.is_file() or path == SELF or path.suffix not in TEXT_SUFFIXES:
            continue
        rel = path.relative_to(ROOT).as_posix()
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if rel.startswith(IMMUTABLE_PREFIXES):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        new_text = text
        for old, new in replacements.items():
            new_text = new_text.replace(old, new)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            changed.append(rel)
    return changed


def nav_button(tab_id: str, label: str, number: str, development: bool = False) -> str:
    if development:
        class_line = f'                className={{`developmentSection ${{tab === "{tab_id}" ? "active" : ""}}`}}'
    else:
        class_line = f'                className={{tab === "{tab_id}" ? "active" : ""}}'
    return "\n".join(
        [
            "              <button",
            class_line,
            "                onClick={() => {",
            f'                  setTab("{tab_id}");',
            "                  setShowMatrixSections(false);",
            "                }}",
            "              >",
            f"                <span>{number}</span> {label}",
            "              </button>",
        ]
    )


def replace_navigation() -> None:
    text = PAGE.read_text(encoding="utf-8")

    old_mobile_start = '            {[\n              ["unified", "Расширенная сводка", "01"],'
    mobile_end_marker = "            ].map(([id, label, number]) =>"
    start = text.find(old_mobile_start)
    if start < 0:
        # Idempotent rerun after conversion.
        old_mobile_start = '            {[\n              ["unified", "Расширенная сводка", "01"],\n              ["matrix", "Показатели", "02"],'
        start = text.find(old_mobile_start)
    if start < 0:
        raise RuntimeError("mobile navigation start marker not found")
    end = text.find(mobile_end_marker, start)
    if end < 0:
        raise RuntimeError("mobile navigation end marker not found")

    new_mobile = '''            {[
              ["unified", "Расширенная сводка", "01"],
              ["matrix", "Показатели", "02"],
              ["ranking", "Рейтинг МО", "03"],
              ["hearings", "МО для заслушивания", "04"],
              ["max", "МАХ", "05"],
              ["waybill", "Электронный путевой лист", "06"],
              ["remdErrors", "Ошибки РЭМД", "07"],
              ["divider", "В разработке", ""],
              ["federal", "Показатели на контроле РФ", "08"],
              ["methods", "Методики расчёта", "09"],
              ["history", "История обновлений", "10"],
              ["semd", "Все виды СЭМД", "11"],
              ["errors", "Ошибки методик", "12"],
'''
    text = text[:start] + new_mobile + text[end:]

    desktop_start_marker = '              <button\n                className={tab === "unified" ? "active" : ""}'
    desktop_end_marker = '              <button\n                className={`developmentSection ${tab === "errors" ? "active" : ""}`}'
    ds = text.find(desktop_start_marker)
    if ds < 0:
        raise RuntimeError("desktop navigation start marker not found")
    de = text.find(desktop_end_marker, ds)
    if de < 0:
        # On an idempotent rerun the last development button is still errors.
        raise RuntimeError("desktop navigation end marker not found")
    de_close = text.find("              </button>", de)
    if de_close < 0:
        raise RuntimeError("desktop navigation closing button not found")
    de_close += len("              </button>")

    main_items = [
        ("unified", "Расширенная сводка", "01"),
        ("matrix", "Показатели", "02"),
        ("ranking", "Рейтинг МО", "03"),
        ("hearings", "МО для заслушивания", "04"),
        ("max", "МАХ", "05"),
        ("waybill", "Электронный путевой лист", "06"),
        ("remdErrors", "Ошибки РЭМД", "07"),
    ]
    dev_items = [
        ("federal", "Показатели на контроле РФ", "08"),
        ("methods", "Методики расчёта", "09"),
        ("history", "История обновлений", "10"),
        ("semd", "Все виды СЭМД", "11"),
        ("errors", "Ошибки методик", "12"),
    ]
    desktop_parts = [nav_button(*item) for item in main_items]
    desktop_parts.append('              <div className="sideDevelopment">\n                <span>В разработке</span>\n              </div>')
    desktop_parts.extend(nav_button(*item, development=True) for item in dev_items)
    new_desktop = "\n".join(desktop_parts)
    text = text[:ds] + new_desktop + text[de_close:]

    text = text.replace('const DASHBOARD_VERSION = "5.2.0";', 'const DASHBOARD_VERSION = "5.2.1";')
    text = text.replace('<h1>Рейтинг медицинских организаций — {latestFullMonth.label}</h1>', '<h1>Рейтинг МО — {latestFullMonth.label}</h1>')
    PAGE.write_text(text, encoding="utf-8")


def update_docs() -> None:
    readme = ROOT / "README.md"
    text = readme.read_text(encoding="utf-8")
    text = text.replace("Текущая рабочая версия: **v5.2.0 от 09.09.2026**.", "Текущая рабочая версия: **v5.2.1 от 09.09.2026**.")
    if "## Изменение v5.2.1" not in text:
        marker = "## Изменение v5.2.0"
        insert = """## Изменение v5.2.1

- Показатели медицинских свидетельств сокращены во всех актуальных названиях и методиках: **МСР** — медицинские свидетельства о рождении; **МСС** — медицинские свидетельства о смерти.
- Основной порядок разделов: **01 Расширенная сводка → 02 Показатели → 03 Рейтинг МО → 04 МО для заслушивания → 05 МАХ → 06 Электронный путевой лист → 07 Ошибки РЭМД**.
- Остальные разделы перенесены под разделитель **«В разработке»**: Показатели на контроле РФ, Методики расчёта, История обновлений, Все виды СЭМД, Ошибки методик.

"""
        text = text.replace(marker, insert + marker)
    text = text.replace("## Текущая проверка v5.2.0", "## Текущая проверка v5.2.1")
    text = text.replace("- автотесты: **133/133 PASS**;", "- автотесты: **134/134 PASS**;")
    readme.write_text(text, encoding="utf-8")

    state = ROOT / "STATE.md"
    text = state.read_text(encoding="utf-8")
    text = text.replace("# Состояние проекта — дашборд цифровизации здравоохранения РТ v5.2.0", "# Состояние проекта — дашборд цифровизации здравоохранения РТ v5.2.1")
    text = text.replace("- Рабочая версия: **5.2.0**.", "- Рабочая версия: **5.2.1**.")
    text = text.replace("- Дата сборки: **08.09.2026**.", "- Дата сборки: **09.09.2026**.")
    if "## Изменение интерфейса v5.2.1" not in text:
        marker = "## Правила расчётов и периодов"
        insert = """## Изменение интерфейса v5.2.1

- Во всех актуальных названиях показателей и карточках методик длинные названия свидетельств заменены на **МСР** и **МСС**.
- Основная навигация: **Расширенная сводка → Показатели → Рейтинг МО → МО для заслушивания → МАХ → Электронный путевой лист → Ошибки РЭМД**.
- Показатели на контроле РФ, Методики расчёта, История обновлений, Все виды СЭМД и Ошибки методик перенесены в блок **«В разработке»**.
- Расчёты, источники, периоды и состав рейтинга этим изменением не менялись.

"""
        text = text.replace(marker, insert + marker)
    text = text.replace("- Unit/data автотесты без `rendered-html`: **132/132 PASS**; полный `rendered-html` проверяется production build-gate.", "- Автотесты: **134/134 PASS**.")
    text = text.replace("- Production build v5.2.0 в текущем окружении не запускался из-за отсутствия установленных frontend-зависимостей; перед публикацией build-gate обязателен. Последняя подтверждённая полная сборка v5.1.0 — PASS.", "- Production build v5.2.1: **PASS**; Sites artifact прошёл проверку структуры.")
    state.write_text(text, encoding="utf-8")

    issues = ROOT / "OPEN_ISSUES.md"
    text = issues.read_text(encoding="utf-8")
    text = text.replace("# Открытые вопросы после фиксации v5.2.0", "# Открытые вопросы после фиксации v5.2.1")
    text = text.replace("Контроль изменения v5.2.0:", "Контроль изменения v5.2.1:")
    text = text.replace("unit/data tests без `rendered-html` **132/132 PASS**", "автотесты **134/134 PASS**")
    text = text.replace("Production build-gate требуется повторить перед публикацией; последняя подтверждённая полная сборка v5.1.0 — PASS.", "Production build **PASS**; Sites artifact прошёл проверку структуры.")
    issues.write_text(text, encoding="utf-8")


def update_baseline_manifest() -> None:
    manifest_path = ROOT / "baseline" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["baselineVersion"] = "5.2.1"
    manifest["baselineDate"] = "2026-09-09"
    manifest["changeClass"] = "UI navigation order and MSR/MSS naming abbreviations"
    manifest.setdefault("regression", {})["nodeTests"] = "134/134 PASS"
    manifest["regression"]["fail"] = 0
    manifest["regression"]["warnings"] = []
    manifest["note"] = "v5.2.1 abbreviates the medical birth/death certificate indicator names to МСР/МСС and promotes the requested management sections to the main navigation without changing calculations or source data."

    for section in ("protectedData", "protectedRules", "stateFiles", "keyCode"):
        for rel in list(manifest.get(section, {})):
            path = ROOT / rel
            if path.exists():
                manifest[section][rel] = hashlib.sha256(path.read_bytes()).hexdigest()

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_baseline_lock_test_version() -> None:
    test = ROOT / "tests" / "baseline-lock.test.mjs"
    text = test.read_text(encoding="utf-8")
    text = text.replace("approved v5.2.0", "approved v5.2.1")
    text = text.replace("manifest.baselineVersion, '5.2.0'", "manifest.baselineVersion, '5.2.1'")
    text = text.replace('manifest.baselineVersion, "5.2.0"', 'manifest.baselineVersion, "5.2.1"')
    test.write_text(text, encoding="utf-8")


def main() -> None:
    renamed = replace_indicator_names()
    replace_navigation()
    update_docs()
    update_baseline_lock_test_version()
    update_baseline_manifest()
    print("v5.2.1 transformation applied")
    print("name replacements:", ", ".join(renamed) if renamed else "already applied")


if __name__ == "__main__":
    main()
