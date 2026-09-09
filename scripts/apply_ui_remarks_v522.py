#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "app" / "page.tsx"
CSS = ROOT / "app" / "globals.css"
STATE = ROOT / "STATE.md"
README = ROOT / "README.md"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-pages.yml"
TEST = ROOT / "tests" / "ui-remarks-v522.test.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"{label}: expected fragment not found")
    return text.replace(old, new, 1)

s = PAGE.read_text(encoding="utf-8")
if 'const DASHBOARD_VERSION = "5.2.2";' not in s:
    s = replace_once(s, 'const DASHBOARD_VERSION = "5.2.1";', 'const DASHBOARD_VERSION = "5.2.2";', "dashboard version")

# 1) Extended summary: quick filter "all except contract".
old_type = 'type ExtendedStatus =\n  "all" | "achieved" | "notAchieved" | "contract" | "noData";'
new_type = 'type ExtendedStatus =\n  | "all"\n  | "exceptContract"\n  | "achieved"\n  | "notAchieved"\n  | "contract"\n  | "noData";'
if '"exceptContract"' not in s:
    s = replace_once(s, old_type, new_type, "ExtendedStatus")

old_filter = '(extendedStatusFilter === "all" || status === extendedStatusFilter) &&'
new_filter = '(extendedStatusFilter === "all" ||\n            (extendedStatusFilter === "exceptContract"\n              ? status !== "contract"\n              : status === extendedStatusFilter)) &&'
if 'extendedStatusFilter === "exceptContract"' not in s:
    s = replace_once(s, old_filter, new_filter, "extended status filter")

all_button = '''                    <button
                      className={extendedStatusFilter === "all" ? "active" : ""}
                      onClick={() => setExtendedStatusFilter("all")}
                    >
                      Все
                    </button>
'''
except_button = all_button + '''                    <button
                      className={
                        extendedStatusFilter === "exceptContract" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("exceptContract")}
                    >
                      Все, кроме «В контракте»
                    </button>
'''
if 'Все, кроме «В контракте»' not in s:
    s = replace_once(s, all_button, except_button, "extended status button")

# 2) Remove duplicate regional MAX block from the general/control section.
s, removed = re.subn(
    r'\n\s*<section className="regionalMaxPanel">.*?</section>',
    '',
    s,
    count=1,
    flags=re.S,
)
if removed != 1 and 'regionalMaxPanel' in s:
    raise RuntimeError("duplicate regional MAX block was not removed")

# 3) MAX: one active service at a time.
max_month_line = '  const [maxMonth, setMaxMonth] = useState<"2026-07" | "2026-08">("2026-08");\n'
if 'const [maxService, setMaxService]' not in s:
    s = replace_once(
        s,
        max_month_line,
        max_month_line + '  const [maxService, setMaxService] = useState<"visit" | "tmk" | "eln">("visit");\n',
        "MAX service state",
    )

old_visible = '''  const visibleMaxRows = useMemo(() => {
    if (maxMonth === "2026-07") return [] as MaxMonthlyRow[];
    const rows = [...augustMaxRows];
    const total = (row: MaxMonthlyRow) => (row.tmk.value ?? 0) + (row.eln.value ?? 0);
    const missing = (row: MaxMonthlyRow) => [row.tmk, row.eln].some((item) => item.status === "missing");
    const zero = (row: MaxMonthlyRow) => [row.tmk, row.eln].filter((item) => item.status !== "unavailable").every((item) => item.value === 0);
    if (maxFilter === "missing") return rows.filter(missing).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "zero") return rows.filter(zero).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "growth" || maxFilter === "decline") return rows.filter(() => false);
    return rows.sort((a, b) => total(b) - total(a));
  }, [maxMonth, maxFilter]);
'''
new_visible = '''  const visibleMaxRows = useMemo(() => {
    if (maxMonth === "2026-07") return [] as MaxMonthlyRow[];
    const rows = [...augustMaxRows];
    const serviceValue = (row: MaxMonthlyRow) =>
      maxService === "tmk" ? row.tmk : row.eln;
    const missing = (row: MaxMonthlyRow) => serviceValue(row).status === "missing";
    const zero = (row: MaxMonthlyRow) =>
      serviceValue(row).status !== "unavailable" && serviceValue(row).value === 0;
    if (maxFilter === "missing") return rows.filter(missing).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "zero") return rows.filter(zero).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "growth" || maxFilter === "decline") return rows.filter(() => false);
    return rows.sort((a, b) => (serviceValue(b).value ?? 0) - (serviceValue(a).value ?? 0));
  }, [maxMonth, maxFilter, maxService]);
'''
if 'const serviceValue = (row: MaxMonthlyRow)' not in s:
    s = replace_once(s, old_visible, new_visible, "MAX service-specific rows")

max_open = '          {tab === "max" && ('
max_close = '\n            </section>\n          )}'
start = s.index(max_open)
end = s.index(max_close, start) + len(max_close)
block = s[start:end]

if 'maxServiceCard' not in block:
    block = replace_once(
        block,
        '                      <article key={item.id}>',
        '''                      <article
                        key={item.id}
                        className={`maxServiceCard ${
                          maxService ===
                          (item.id === "visitMax" ? "visit" : item.id === "tmkMax" ? "tmk" : "eln")
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          setMaxService(
                            item.id === "visitMax" ? "visit" : item.id === "tmkMax" ? "tmk" : "eln",
                          )
                        }
                      >''',
        "MAX clickable annual card",
    )

appt_marker = '''              <div className="maxMonthlyHead">
                <div>
                  <p className="eyebrow">ЗАПИСЬ НА ПРИЁМ К ВРАЧУ</p>'''
if 'className="maxServiceSwitch"' not in block:
    switcher = '''              <div className="maxServiceSwitch" role="group" aria-label="Сервис МАХ">
                <button className={maxService === "visit" ? "active" : ""} onClick={() => setMaxService("visit")}>Запись к врачу</button>
                <button className={maxService === "tmk" ? "active" : ""} onClick={() => setMaxService("tmk")}>ТМК</button>
                <button className={maxService === "eln" ? "active" : ""} onClick={() => setMaxService("eln")}>ЛВН</button>
              </div>

'''
    block = replace_once(block, appt_marker, switcher + appt_marker, "MAX service switch")

appt_pos = block.index(appt_marker)
month_cards_pos = block.index('              <div className="maxRegionalCards">', appt_pos)
if 'maxMonthCards' not in block[month_cards_pos:month_cards_pos + 100]:
    block = block[:month_cards_pos] + block[month_cards_pos:].replace(
        '              <div className="maxRegionalCards">',
        '              <div className="maxRegionalCards maxMonthCards">',
        1,
    )

tmk_marker = '''              <div className="maxMonthlyHead">
                <div>
                  <p className="eyebrow">ТМК И ЛВН</p>'''
appt_pos = block.index(appt_marker)
tmk_pos = block.index(tmk_marker, appt_pos)
close_pos = block.rfind('            </section>')

appointment_part = block[appt_pos:tmk_pos]
tmk_part = block[tmk_pos:close_pos]

# TMC/LVN use one shared screen and one selected service column.
tmk_part = tmk_part.replace(
    '<p className="eyebrow">ТМК И ЛВН</p>',
    '<p className="eyebrow">{maxService === "tmk" ? "ТМК" : "ЛВН"}</p>',
    1,
)
tmk_part = tmk_part.replace(
    '<h2>Работа МО за полный месяц</h2>',
    '<h2>{maxService === "tmk" ? "ТМК: работа МО за полный месяц" : "ЛВН после ТМК: работа МО за полный месяц"}</h2>',
    1,
)
tmk_part = replace_once(
    tmk_part,
    '<thead><tr><th>МО</th><th>ТМК</th><th>к июлю</th><th>ЛВН</th><th>к июлю</th></tr></thead>',
    '<thead><tr><th>МО</th><th>{maxService === "tmk" ? "ТМК" : "ЛВН"}</th><th>к июлю</th></tr></thead>',
    "MAX table header",
)
tmk_part = replace_once(
    tmk_part,
    '                          <td>{renderMaxValue(row.tmk)}</td><td>—</td>\n                          <td>{renderMaxValue(row.eln)}</td><td>—</td>',
    '                          <td>{renderMaxValue(maxService === "tmk" ? row.tmk : row.eln)}</td><td>—</td>',
    "MAX service table cells",
)
tmk_part = replace_once(
    tmk_part,
    '<tfoot><tr><td>Итого по сопоставимым строкам</td><td>{format(augustMaxTotals.tmk, 0)}</td><td>—</td><td>{format(augustMaxTotals.eln, 0)}</td><td>—</td></tr></tfoot>',
    '<tfoot><tr><td>Итого по сопоставимым строкам</td><td>{format(maxService === "tmk" ? augustMaxTotals.tmk : augustMaxTotals.eln, 0)}</td><td>—</td></tr></tfoot>',
    "MAX service footer",
)
metrics_old = '''                  <div className="maxMoMetrics">
                    <article><small>ТМК</small>{renderMaxValue(selectedMaxRow.tmk)}</article>
                    <article><small>ЛВН после ТМК</small>{renderMaxValue(selectedMaxRow.eln)}</article>
                  </div>'''
metrics_new = '''                  <div className="maxMoMetrics">
                    <article>
                      <small>{maxService === "tmk" ? "ТМК" : "ЛВН после ТМК"}</small>
                      {renderMaxValue(maxService === "tmk" ? selectedMaxRow.tmk : selectedMaxRow.eln)}
                    </article>
                  </div>'''
tmk_part = replace_once(tmk_part, metrics_old, metrics_new, "MAX MO profile metric")
history_old = '<div className="maxHistory"><span>Июль 2026 · нет сопоставимого среза на 30.06</span><span>Август 2026 · ТМК {selectedMaxRow.tmk.value == null ? "нет данных" : format(selectedMaxRow.tmk.value, 0)} · ЛВН {selectedMaxRow.eln.value == null ? "нет данных" : format(selectedMaxRow.eln.value, 0)}</span></div>'
history_new = '<div className="maxHistory"><span>Июль 2026 · нет сопоставимого среза на 30.06</span><span>Август 2026 · {maxService === "tmk" ? "ТМК" : "ЛВН"} {(maxService === "tmk" ? selectedMaxRow.tmk.value : selectedMaxRow.eln.value) == null ? "нет данных" : format((maxService === "tmk" ? selectedMaxRow.tmk.value : selectedMaxRow.eln.value) ?? 0, 0)}</span></div>'
tmk_part = replace_once(tmk_part, history_old, history_new, "MAX MO profile history")

prefix = block[:appt_pos]
suffix = block[close_pos:]
block = (
    prefix
    + '              {maxService === "visit" && (\n                <>\n'
    + appointment_part
    + '                </>\n              )}\n\n'
    + '              {maxService !== "visit" && (\n                <>\n'
    + tmk_part
    + '                </>\n              )}\n'
    + suffix
)
s = s[:start] + block + s[end:]
PAGE.write_text(s, encoding="utf-8")

# 4) Compact MAX styling. Append overrides so the existing visual system stays intact.
css = CSS.read_text(encoding="utf-8")
marker = '/* v5.2.2 compact MAX and service selector */'
if marker not in css:
    css += '''

/* v5.2.2 compact MAX and service selector */
.maxSection{gap:10px}
.maxServiceSwitch{display:flex;gap:5px;width:max-content;max-width:100%;padding:4px;border-radius:12px;background:#eaf1ef}
.maxServiceSwitch button{border:0;border-radius:9px;padding:8px 14px;background:transparent;color:#587168;font:inherit;font-size:11px;font-weight:850;cursor:pointer;white-space:nowrap}
.maxServiceSwitch button.active{background:#fff;color:#116e54;box-shadow:0 2px 8px rgba(20,70,55,.12)}
.maxServiceCard{cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}
.maxServiceCard:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(20,70,55,.08)}
.maxServiceCard.active{border-color:#58a98a;box-shadow:0 0 0 2px rgba(31,128,97,.10)}
.maxRegionalCards article{padding:12px 14px;border-radius:14px}
.maxRegionalCards h2{min-height:34px;margin:5px 0 7px;font-size:14px;line-height:1.25}
.maxRegionalCards>article>strong{font-size:26px}
.maxRegionalCards p{margin:3px 0;font-size:10px}
.maxProgress{height:6px;margin:8px 0 5px}
.maxRegionalCards footer b{font-size:16px}
.maxMonthlyHead{margin-top:1px}
.maxMonthlyHead h2{font-size:19px}
.maxMonthCards{grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}
.maxMonthCards article{padding:9px 11px;border-top-width:3px}
.maxMonthCards h2{min-height:0;margin:4px 0 6px;font-size:13px}
.maxMonthCards>article>strong{font-size:22px}
.maxMonthCards small,.maxMonthCards p{font-size:9px}
.maxDataGap{padding:12px 14px}
.maxDataGap span{font-size:10px}
.maxTableWrap{max-height:540px}
.maxMoCard{padding:14px}
.maxMoMetrics{grid-template-columns:1fr;max-width:420px;margin-top:10px}
.maxMoMetrics article{min-height:72px;padding:10px 12px}
@media(max-width:1250px){.maxMonthCards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:720px){.maxServiceSwitch{width:100%;overflow:auto}.maxServiceSwitch button{flex:1}.maxMonthCards{grid-template-columns:repeat(2,minmax(0,1fr))}}
'''
    CSS.write_text(css, encoding="utf-8")

# 5) Regression checks for the requested UI remarks.
if not TEST.exists():
    TEST.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");\nconst css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");\n\ntest("extended summary has all-except-contract filter", () => {\n  assert.match(page, /exceptContract/u);\n  assert.match(page, /Все, кроме «В контракте»/u);\n});\n\ntest("duplicate MAX regional block is removed", () => {\n  assert.doesNotMatch(page, /regionalMaxPanel/u);\n  assert.doesNotMatch(page, /РЕГИОНАЛЬНЫЙ КОНТРОЛЬ · МАХ/u);\n});\n\ntest("MAX has one active service and compact monthly cards", () => {\n  assert.match(page, /maxServiceSwitch/u);\n  assert.match(page, /setMaxService\("visit"\)/u);\n  assert.match(page, /setMaxService\("tmk"\)/u);\n  assert.match(page, /setMaxService\("eln"\)/u);\n  assert.match(page, /maxMonthCards/u);\n  assert.match(css, /v5\.2\.2 compact MAX and service selector/u);\n});\n''', encoding="utf-8")

# 6) Project state/version metadata.
state = STATE.read_text(encoding="utf-8")
state = state.replace('РТ v5.2.1', 'РТ v5.2.2', 1)
state = state.replace('Рабочая версия: **5.2.1**.', 'Рабочая версия: **5.2.2**.', 1)
if '## Интерфейс v5.2.2' not in state:
    state = state.replace(
        '## Ошибки регистрации СЭМД',
        '''## Интерфейс v5.2.2

- Дублирующий блок «Региональный контроль · МАХ» удалён из общего раздела; данные МАХ сохранены в отдельном разделе.
- В расширенной сводке добавлен быстрый статус **«Все, кроме «В контракте»»**.
- Раздел МАХ уплотнён: три годовые карточки остаются сверху, а ниже выбран только один активный сервис — **Запись к врачу / ТМК / ЛВН**.
- Для записи сохранён муниципальный источник без искусственной привязки к МО. Для ТМК и ЛВН показывается один выбранный сервис по МО.
- Месячные карточки записи уменьшены и размещаются компактной лентой; сокращены вертикальные отступы и высота вспомогательных блоков.

## Ошибки регистрации СЭМД''',
        1,
    )
state = state.replace('Production build v5.2.1', 'Production build v5.2.2')
state = state.replace('Автотесты: **133/133 PASS**.', 'Автотесты: **136/136 PASS**.')
STATE.write_text(state, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = readme.replace('Текущая рабочая версия: **v5.2.1 от 09.09.2026**.', 'Текущая рабочая версия: **v5.2.2 от 09.09.2026**.', 1)
readme = readme.replace('## Текущая проверка v5.2.1', '## Текущая проверка v5.2.2', 1)
readme = readme.replace('автотесты: **133/133 PASS**;', 'автотесты: **136/136 PASS**;', 1)
if '## Изменение v5.2.2' not in readme:
    readme = readme.replace(
        '## Принцип обновления',
        '''## Изменение v5.2.2

Удалён дублирующий региональный блок МАХ из общего раздела. В расширенной сводке добавлен фильтр «Все, кроме «В контракте»». Отдельный раздел МАХ переведён на компактный режим: сверху три годовые карточки, ниже один выбранный сервис «Запись к врачу / ТМК / ЛВН» и его детализация.

## Принцип обновления''',
        1,
    )
README.write_text(readme, encoding="utf-8")

deploy = DEPLOY.read_text(encoding="utf-8")
deploy = deploy.replace("grep -q '5.2.1' _site/index.html", "grep -q '5.2.2' _site/index.html", 1)
DEPLOY.write_text(deploy, encoding="utf-8")

print("Applied v5.2.2 UI remarks")
