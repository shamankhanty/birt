import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estimateAttachmentInflow } from "../lib/egpu-attachment-inflow.js";

const data = JSON.parse(readFileSync(new URL("../app/mo-data.json", import.meta.url), "utf8"));

test("both EPGU attachment indicators use the same denominator growth, not the numerator", () => {
  const first = estimateAttachmentInflow(data.egpu);
  const timely = estimateAttachmentInflow(data.egpu2days);
  assert.ok(first);
  assert.ok(timely);
  assert.deepEqual(first, timely);
  assert.equal(first.count, 610);
  assert.equal(first.currentTotal, 49169);
  assert.equal(first.previousTotal, 48559);
  assert.equal(first.previousDate, "19.11.2026");
  assert.equal(first.currentDate, "22.11.2026");
  assert.notEqual(first.count, data.egpu.numerator - data.egpu.previousNumerator);
  assert.notEqual(first.count, data.egpu2days.numerator - data.egpu2days.previousNumerator);
});

test("subsequent compatible source updates recompute the count without a hardcoded date", () => {
  const modified = { ...data.egpu, date: "26.11.2026", previousDate: "22.11.2026",
    period: "01.01–26.11.2026", previousPeriod: "01.01–22.11.2026",
    previousDenominator: 49169, denominator: 50300 };
  assert.equal(estimateAttachmentInflow(modified).count, 1131);
});

test("missing, negative or incomparable data never becomes zero new applications", () => {
  const base = data.egpu2days;
  for (const modified of [
    { ...base, previousDenominator: null },
    { ...base, previousDate: null },
    { ...base, previousPeriod: "01.11–12.11.2026" },
    { ...base, period: "01.11–19.11.2026" },
    { ...base, previousDate: "26.11.2026" },
    { ...base, denominator: base.previousDenominator - 1 },
    { ...base, denominator: "48559" },
    { ...base, period: "01.01–18.11.2026" },
    { ...base, previousDate: "12.11.2025", previousPeriod: "01.01–12.11.2025" },
  ]) assert.equal(estimateAttachmentInflow(modified), null);
  assert.equal(estimateAttachmentInflow({ ...base, denominator: base.previousDenominator }).count, 0);
});

test("detail page shows the compact estimate for both EPGU indicators", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /matrixMetric === "egpu" \|\| matrixMetric === "egpu2days"/u);
  assert.match(page, /data-testid="attachment-inflow"/u);
  assert.match(page, /const attachmentSourceDataset = activeMoDataRaw\[matrixMetric\];/u);
  assert.match(page, /estimateAttachmentInflow\(attachmentSourceDataset\)/u);
  assert.match(page, /Не число уникальных новых обращений: возможны корректировки/u);
});
