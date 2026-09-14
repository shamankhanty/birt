from pathlib import Path

page = Path("app/page.tsx")
s = page.read_text(encoding="utf-8")

needle = '      "Верхние плашки «Расширенной сводки» синхронизированы с актуальными источниками: краткий ввод, госпитализации, ФАП/ФП и СЭМД — по 11.09; ошибки РЭМД — за полную неделю 07–13.09.",\n'
addition = '      "МАХ разделён по периодам: верхний блок — накопительный итог РТ; недельная динамика показывается только при наличии двух полных сопоставимых недель; месячная — август к июлю. Ложное сравнение накопительных срезов 07.09 → 11.09 удалено.",\n'
if addition not in s:
    assert needle in s
    s = s.replace(needle, needle + addition, 1)

replacements = [
    (
        'note: "Оперативный факт на 07.09.2026 — 103 940 при плане 193 000 на 2026 год. Для рейтинга МО используются полные накопительные срезы на 31.07 и 31.08; оперативный итог РТ показывается отдельно.",',
        'note: "Официальный план РТ — 193 000 на 2026 год. Верхний факт показывается накопительно. Недельная динамика рассчитывается только по двум полным сопоставимым неделям; месячная — месяц к месяцу. Накопительные срезы не выдаются за недельный или месячный объём.",',
    ),
    (
        'note: "Оперативный факт на 07.09.2026 — 77 629 при плане 99 000 на 2026 год. Для рейтинга МО используются полные накопительные срезы на 31.07 и 31.08.",',
        'note: "Официальный план РТ — 99 000 на 2026 год. Верхний факт показывается накопительно. Недельная динамика рассчитывается только по двум полным сопоставимым неделям; месячная — месяц к месяцу. ЛВН не суммируются с ТМК.",',
    ),
]
for old, new in replacements:
    if old in s:
        s = s.replace(old, new, 1)

needle = '''  const maxMetricTotals = {\n    tmk: calculatedIndicatorById.tmkMaxCount?.fact ?? 0,\n    eln: calculatedIndicatorById.elnMaxCount?.fact ?? 0,\n  };\n'''
addition = '''  const maxAnnualPlan = matrixMetric === "tmkMaxCount" ? 193000 : 99000;\n  const maxAugustMonthlyDataset: MonthlyMoDataset | null = isMaxMetric\n    ? {\n        unit: "count",\n        previousLabel: "Июль 2026",\n        currentLabel: "Август 2026",\n        rows: augustMaxRows.map((row) => {\n          const value = matrixMetric === "tmkMaxCount" ? row.tmk : row.eln;\n          return {\n            name: row.name,\n            june: null,\n            july: value.value,\n            change: null,\n            juneQuantity: null,\n            julyQuantity: value.value === null ? null : format(value.value, 0),\n            sourceWarning:\n              "Август рассчитан как накопительный срез 31.08 минус 31.07. Для сравнения июля с августом по МО нужен сопоставимый срез на 30.06; его в текущем наборе нет.",\n          };\n        }),\n      }\n    : null;\n'''
if addition not in s:
    assert needle in s
    s = s.replace(needle, needle + addition, 1)

old = '''  const periods = isMaxMetric\n    ? {\n        previous: selectedDataset.previousPeriod ?? selectedDataset.previousDate ?? "нет сопоставимого предыдущего среза",\n        current: selectedDataset.period ?? `на ${selectedDataset.date}`,\n      }\n    : comparisonPeriods[matrixMetric] ?? {\n'''
new = '''  const periods = isMaxMetric\n    ? {\n        previous: "нет двух полных сопоставимых недель",\n        current: `накопительный срез на ${selectedDataset.date}`,\n      }\n    : comparisonPeriods[matrixMetric] ?? {\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''  const regionalPrevious = operationalRegionalPrevious[matrixMetric] ?? (isCountMetric\n    ? indicatorRows.reduce((sum, row) => sum + (row.previous ?? 0), 0)\n    : rtIndicator?.trend === null || rtIndicator?.trend === undefined\n      ? null\n      : regionalFact - rtIndicator.trend);\n'''
new = '''  const regionalPrevious = isMaxMetric\n    ? null\n    : operationalRegionalPrevious[matrixMetric] ?? (isCountMetric\n      ? indicatorRows.reduce((sum, row) => sum + (row.previous ?? 0), 0)\n      : rtIndicator?.trend === null || rtIndicator?.trend === undefined\n        ? null\n        : regionalFact - rtIndicator.trend);\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''  const monthlyDataset =\n    matrixMetric === "semd228"\n      ? { ...monthlyMoData.semd228, rows: adultPreventiveMonthlyRows }\n      : monthlyMoData[matrixMetric];\n'''
new = '''  const monthlyDataset =\n    matrixMetric === "semd228"\n      ? { ...monthlyMoData.semd228, rows: adultPreventiveMonthlyRows }\n      : isMaxMetric\n        ? maxAugustMonthlyDataset\n        : monthlyMoData[matrixMetric];\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''                  <small>\n                    {isMaxMetric\n                      ? "Месячный план"\n                      : isCountMetric\n                        ? "Период"\n                        : "Плановый показатель"}\n                  </small>\n                  <strong>\n                    {isMaxMetric\n                      ? "10 000 в месяц"\n                      : isCountMetric\n                        ? (selectedDataset.period ?? selectedDataset.date)\n                        : selectedDataset.plan === null\n                          ? "не установлен"\n                          : `${rtIndicator?.reverse ? "≤" : "≥"} ${format(selectedDataset.plan, 0)}%`}\n                  </strong>\n                  <span>\n                    {isMaxMetric\n                      ? `оперативный срез на ${selectedDataset.date}`\n                      : `актуальность ${selectedDataset.date}`}\n                  </span>\n'''
new = '''                  <small>\n                    {isMaxMetric\n                      ? "Годовой план РТ"\n                      : isCountMetric\n                        ? "Период"\n                        : "Плановый показатель"}\n                  </small>\n                  <strong>\n                    {isMaxMetric\n                      ? format(maxAnnualPlan, 0)\n                      : isCountMetric\n                        ? (selectedDataset.period ?? selectedDataset.date)\n                        : selectedDataset.plan === null\n                          ? "не установлен"\n                          : `${rtIndicator?.reverse ? "≤" : "≥"} ${format(selectedDataset.plan, 0)}%`}\n                  </strong>\n                  <span>\n                    {isMaxMetric\n                      ? `официальный план · факт накопительно на ${selectedDataset.date}`\n                      : `актуальность ${selectedDataset.date}`}\n                  </span>\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''                  <p>\n                    Один раздел: итог по РТ и детализация по МО переключаются\n                    вместе.\n                  </p>\n'''
new = '''                  <p>\n                    Верхние значения — накопительный итог РТ. Недельная и\n                    месячная динамика ниже рассчитываются отдельно и не\n                    смешиваются с накопительным фактом.\n                  </p>\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''                {dynamicsMode === "week" ? (\n                  <div className="dynamicsCards">\n'''
new = '''                {dynamicsMode === "week" && isMaxMetric ? (\n                  <div className="monthEmpty">\n                    <b>Нет двух полных сопоставимых недель</b>\n                    <span>\n                      Срез 11.09.2026 является накопительным и сформирован до\n                      завершения недели 08–14.09. Он не сравнивается с\n                      накопительным срезом 07.09 как «неделя к неделе».\n                      Недельная динамика появится после загрузки двух полных\n                      недельных периодов одинаковой длительности.\n                    </span>\n                  </div>\n                ) : dynamicsMode === "week" ? (\n                  <div className="dynamicsCards">\n'''
if old in s:
    s = s.replace(old, new, 1)

old = '''                        {isMaxMetric\n                          ? `${format((regionalFact / Math.max(1, selectedDataset.plan ?? 1)) * 100, 1)}% годового плана · `\n                          : ""}\n'''
new = '''                        {isMaxMetric\n                          ? `${format((regionalFact / Math.max(1, maxAnnualPlan)) * 100, 1)}% годового плана РТ · `\n                          : ""}\n'''
if old in s:
    s = s.replace(old, new, 1)

marker = '              {dynamicsMode === "month" ? ('
idx = s.find(marker)
assert idx >= 0
old = '''              ) : (\n                <>\n                  {selectedUnitDataset ? (\n'''
new = '''              ) : isMaxMetric ? (\n                <section className="monthlyNoDetail">\n                  <b>Недельная детализация по МО не показана</b>\n                  <span>\n                    Текущая выгрузка МАХ содержит накопительные значения по МО\n                    на 11.09.2026, а не объёмы за полную неделю. Показывать их\n                    в режиме «Неделя» как недельный результат нельзя. После\n                    появления двух полных недельных срезов таблица будет\n                    построена как неделя к предыдущей неделе.\n                  </span>\n                </section>\n              ) : (\n                <>\n                  {selectedUnitDataset ? (\n'''
pos = s.find(old, idx)
if pos >= 0:
    s = s[:pos] + new + s[pos + len(old):]

for required in (
    "Верхние значения — накопительный итог РТ",
    "Нет двух полных сопоставимых недель",
    "Недельная детализация по МО не показана",
    "maxAugustMonthlyDataset",
    "Годовой план РТ",
):
    assert required in s, required
page.write_text(s, encoding="utf-8")

p = Path("tests/v540-operational-update.test.mjs")
t = p.read_text(encoding="utf-8")
old = '''test('MAX comparison periods follow real source cuts', () => {\n  for (const id of ['tmkMaxCount','elnMaxCount']) {\n    assert.equal(op[id].previousDate, '07.09.2026');\n    assert.equal(op[id].previousPeriod, '01.01–07.09.2026');\n    assert.equal(op[id].date, '11.09.2026');\n    assert.equal(op[id].period, '01.01–11.09.2026');\n  }\n  assert.ok(page.includes('selectedDataset.previousPeriod ?? selectedDataset.previousDate'));\n});\n'''
new = '''test('MAX does not label cumulative cuts as week-to-week dynamics', () => {\n  for (const id of ['tmkMaxCount','elnMaxCount']) {\n    assert.equal(op[id].date, '11.09.2026');\n    assert.equal(op[id].period, '01.01–11.09.2026');\n  }\n  assert.ok(page.includes('Нет двух полных сопоставимых недель'));\n  assert.ok(page.includes('Недельная детализация по МО не показана'));\n  assert.ok(page.includes('const regionalPrevious = isMaxMetric'));\n});\n'''
if old in t:
    t = t.replace(old, new, 1)
assert "MAX does not label cumulative cuts as week-to-week dynamics" in t
p.write_text(t, encoding="utf-8")

p = Path("tests/max-section.test.mjs")
t = p.read_text(encoding="utf-8")
addition = '''\n\ntest("MAX period modes do not mix cumulative, weekly and monthly values", () => {\n  assert.match(page, /Верхние значения — накопительный итог РТ/u);\n  assert.match(page, /Годовой план РТ/u);\n  assert.match(page, /193000/u);\n  assert.match(page, /99000/u);\n  assert.match(page, /Нет двух полных сопоставимых недель/u);\n  assert.match(page, /Недельная детализация по МО не показана/u);\n  assert.match(page, /maxAugustMonthlyDataset/u);\n  assert.match(page, /Август рассчитан как накопительный срез 31\\.08 минус 31\\.07/u);\n  assert.match(page, /Для сравнения июля с августом по МО нужен сопоставимый срез на 30\\.06/u);\n});\n'''
if "MAX period modes do not mix cumulative, weekly and monthly values" not in t:
    t += addition
p.write_text(t, encoding="utf-8")

print("MAX period correction applied")
