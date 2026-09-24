import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/birt-cloud-updater.yml", "utf8");
test("cloud updater archives only accepted PREPARED or UNCHANGED sources", () => {
  assert.match(workflow, /item\.get\(["']state["']\) in \{["']PREPARED["'], ["']UNCHANGED["']\}/u);
  assert.match(workflow, /--name/gu);
  assert.doesNotMatch(workflow, /python scripts\/yandex_disk_inbox\.py --remote "\$BIRT_YANDEX_INBOX" --archive-to "\$BIRT_YANDEX_ARCHIVE"\s*$/mu);
});
