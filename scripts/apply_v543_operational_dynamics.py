#!/usr/bin/env python3
"""One-shot bootstrap for v5.4.3. Removed by the bootstrap workflow after use."""
from __future__ import annotations
import base64
import gzip
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
page = (ROOT / "app" / "page.tsx").read_text(encoding="utf-8")
if 'const DASHBOARD_VERSION = "5.4.3";' in page:
    print("v5.4.3 patch already applied")
    raise SystemExit(0)
if 'const DASHBOARD_VERSION = "5.4.2";' not in page:
    raise SystemExit("Refusing to patch: expected v5.4.2 baseline")

payload = "".join(
    (ROOT / "scripts" / f".v543_payload_{index}").read_text(encoding="utf-8").strip()
    for index in range(1, 5)
)
patch = gzip.decompress(base64.b64decode(payload))
subprocess.run(["git", "apply", "-p1", "--check", "-"], cwd=ROOT, input=patch, check=True)
subprocess.run(["git", "apply", "-p1", "--whitespace=nowarn", "-"], cwd=ROOT, input=patch, check=True)
updated = (ROOT / "app" / "page.tsx").read_text(encoding="utf-8")
if 'const DASHBOARD_VERSION = "5.4.3";' not in updated:
    raise SystemExit("Patch did not produce v5.4.3")
print("v5.4.3 operational dynamics patch applied")
