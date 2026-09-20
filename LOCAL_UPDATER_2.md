# BIRT Local Updater v2

Updater v2 always builds an isolated candidate under `REPORTS/<run>/candidate`. The source files are copied into the run input snapshot; `INBOX`, Excel originals and `app/` remain unchanged during staging. Staging validation must report the expected Prepared, Retained, Missing and Unknown states and must have no FAIL or blocking result.

Acceptance compares the candidate with current production by indicator. Prepared indicators may replace their corresponding sections, Retained indicators keep the current production value and period, Missing sources remain unchanged, and rejected or unknown sources are excluded. Monthly rating data, registry/OID data, MAX and 500+ operational rules are checked separately.

Promotion is an explicit operation:

```powershell
node scripts/promote-current-production.mjs --candidate REPORTS/<run>/candidate
```

The command accepts only a validated candidate with the expected 27/2/5/7 result, performs a selective JSON-section merge, and writes `baseline/current-production-manifest.json`. That manifest is the current production/operational snapshot. It is allowed to change only during an explicit promotion.

`baseline/reference-v4.6.0-manifest.json`, historical fixtures, semantic and methodology anchors, and the MO/OID registry baseline are immutable regression material. Ordinary source refreshes do not rewrite them. Current calculation and validation snapshots belong to the current-production promotion process and must be regenerated only after acceptance.

Every promotion creates a rollback directory under `REPORTS/current-production-rollback-*` containing the production files and the previous current-production manifest. To restore both data and snapshot metadata:

```powershell
node scripts/rollback-current-production.mjs --snapshot REPORTS/current-production-rollback-<timestamp>
```

Post-promotion validation and regression tests are mandatory. If either fails, rollback restores production and the current-production manifest together. Historical baseline hashes must remain byte-identical before and after promotion.
