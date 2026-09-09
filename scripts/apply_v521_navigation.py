from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "app" / "page.tsx"

PHRASE_REPLACEMENTS = (
    ("Доля медицинских свидетельств о рождении относительно общего количества актов гражданского состояния", "МСР"),
    ("Доля медицинских свидетельств о рождении относительно актов гражданского состояния", "МСР"),
    ("Доля медицинских свидетельств о смерти относительно общего количества актов гражданского состояния", "МСС"),
    ("Доля медицинских свидетельств о смерти относительно актов гражданского состояния", "МСС"),
)

TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".py"}
SCAN_ROOTS = ["app", "config", "lib", "methodology", "scripts", "tests"]
ROOT_DOCS = ["README.md", "STATE.md", "OPEN_ISSUES.md", "SOURCE_PACKAGE.md"]

PRIMARY = [
    ("unified", "Расширенная сводка", "01"),
    ("matrix", "Показатели", "02"),
    ("ranking", "Рейтинг медицинских организаций", "03"),
    ("hearings", "МО для заслушивания", "04"),
    ("max", "МАХ", "05"),
    ("waybill", "Электронный путевой лист", "06"),
    ("remdErrors", "Ошибки РЭМД", "07"),
]

DEVELOPMENT = [
    ("federal", "Показатели на контроле РФ", "08"),
    ("methods", "Методики расчёта", "09"),
    ("history", "История обновлений", "10"),
    ("semd", "Все виды СЭМД", "11"),
    ("errors", "Ошибки методик", "12"),
]

CURRENT_LABELS = {
    "unified": "Расширенная сводка",
    "federal": "Показатели на контроле РФ",
    "matrix": "Показатели",
    "max": "МАХ",
    "hearings": "МО для заслушивания",
    "waybill": "Электронный путевой лист",
    "remdErrors": "Ошибки РЭМД",
    "methods": "Методики расчёта",
    "history": "История обновлений",
    "ranking": "Рейтинг медицинских организаций",
    "semd": "Все виды СЭМД",
    "errors": "Ошибки методик",
}


def replace_phrases() -> list[str]:
    changed: list[str] = []
    candidates: list[Path] = []
    for root_name in SCAN_ROOTS:
        root = ROOT / root_name
        if not root.exists():
            continue
        candidates.extend(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES)
    candidates.extend(ROOT / name for name in ROOT_DOCS if (ROOT / name).exists())

    for path in candidates:
        if "baseline" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        updated = text
        for old, new in PHRASE_REPLACEMENTS:
            updated = updated.replace(old, new)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))
    return changed


def render_button(tab: str, label: str, number: str, development: bool = False) -> str:
    if development:
        class_line = f'                className={{`developmentSection ${{tab === "{tab}" ? "active" : ""}}`}}'
    else:
        class_line = f'                className={{tab === "{tab}" ? "active" : ""}}'
    return "\n".join([
        "              <button",
        class_line,
        "                onClick={() => {",
        f'                  setTab("{tab}");',
        "                  setShowMatrixSections(false);",
        "                }}",
        "              >",
        f"                <span>{number}</span> {label}",
        "              </button>",
    ])


def patch_navigation() -> None:
    page = PAGE.read_text(encoding="utf-8")
    original = page
    page = page.replace('const DASHBOARD_VERSION = "5.2.0";', 'const DASHBOARD_VERSION = "5.2.1";')

    mobile_pattern = re.compile(
        r'\{\[\n\s+\["unified", "Расширенная сводка", "\d+"\],.*?\n\s+\]\.map\(\(\[id, label, number\]\) =>',
        re.S,
    )
    mobile_rows = PRIMARY + [("divider", "В разработке", "")] + DEVELOPMENT
    mobile_body = "{[\n" + "\n".join(
        f'              ["{tab}", "{label}", "{number}"],' for tab, label, number in mobile_rows
    ) + "\n            ].map(([id, label, number]) =>"
    page, count = mobile_pattern.subn(mobile_body, page, count=1)
    if count != 1:
        raise RuntimeError(f"Mobile navigation block not found uniquely: {count}")

    aside_start = page.find('<aside\n          className={`sidebar')
    if aside_start < 0:
        raise RuntimeError("Desktop sidebar start not found")
    aside_end = page.find("</aside>", aside_start)
    if aside_end < 0:
        raise RuntimeError("Desktop sidebar end not found")
    aside = page[aside_start:aside_end]

    matches: dict[str, re.Match[str]] = {}
    for tab, label in CURRENT_LABELS.items():
        pattern = re.compile(
            r'\n\s*<button\b(?:(?!</button>).)*?setTab\("' + re.escape(tab) + r'"\);(?:(?!</button>).)*?<span>\d+</span>\s*' + re.escape(label) + r'\s*</button>',
            re.S,
        )
        found = list(pattern.finditer(aside))
        if len(found) != 1:
            raise RuntimeError(f"Sidebar button {tab!r} found {len(found)} times")
        matches[tab] = found[0]

    nav_start = min(m.start() for m in matches.values())
    nav_end = max(m.end() for m in matches.values())
    before = aside[:nav_start]
    after = aside[nav_end:]

    primary_markup = "\n" + "\n".join(render_button(*item, development=False) for item in PRIMARY)
    divider_markup = '\n              <div className="sideDevelopment">\n                <span>В разработке</span>\n              </div>'
    development_markup = "\n" + "\n".join(render_button(*item, development=True) for item in DEVELOPMENT)
    new_aside = before + primary_markup + divider_markup + development_markup + after
    page = page[:aside_start] + new_aside + page[aside_end:]

    if page == original:
        raise RuntimeError("Navigation patch produced no changes")
    PAGE.write_text(page, encoding="utf-8")


def verify() -> None:
    page = PAGE.read_text(encoding="utf-8")
    if 'const DASHBOARD_VERSION = "5.2.1";' not in page:
        raise RuntimeError("Dashboard version was not updated to 5.2.1")
    expected = [
        '["unified", "Расширенная сводка", "01"]',
        '["matrix", "Показатели", "02"]',
        '["ranking", "Рейтинг медицинских организаций", "03"]',
        '["hearings", "МО для заслушивания", "04"]',
        '["max", "МАХ", "05"]',
        '["waybill", "Электронный путевой лист", "06"]',
        '["remdErrors", "Ошибки РЭМД", "07"]',
        '["divider", "В разработке", ""]',
        '["federal", "Показатели на контроле РФ", "08"]',
    ]
    positions = [page.find(token) for token in expected]
    if any(pos < 0 for pos in positions) or positions != sorted(positions):
        raise RuntimeError("Mobile navigation order verification failed")

    for old, _new in PHRASE_REPLACEMENTS:
        for root_name in SCAN_ROOTS:
            root = ROOT / root_name
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES or "baseline" in path.parts:
                    continue
                if old in path.read_text(encoding="utf-8"):
                    raise RuntimeError(f"Old indicator title remains in {path.relative_to(ROOT)}")


if __name__ == "__main__":
    changed = replace_phrases()
    patch_navigation()
    verify()
    print("Updated phrase files:")
    for item in changed:
        print(f" - {item}")
    print("Navigation updated to primary 01–07; all other sections moved under 'В разработке'.")
