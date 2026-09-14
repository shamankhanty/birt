#!/usr/bin/env python3
from pathlib import Path
import base64, zlib, subprocess, shutil

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "summary-v540"
encoded = "".join(p.read_text(encoding="utf-8").strip() for p in sorted(TMP.glob("patch.part*")))
patch = ROOT / ".summary-v540.patch"
patch.write_bytes(zlib.decompress(base64.b64decode(encoded)))
subprocess.run(["git", "apply", "--whitespace=nowarn", str(patch)], cwd=ROOT, check=True)
patch.unlink(missing_ok=True)
shutil.rmtree(TMP, ignore_errors=True)
(ROOT / "scripts" / "apply_summary_sync_v540.py").unlink(missing_ok=True)
(ROOT / ".github" / "workflows" / "sync-summary-v540.yml").unlink(missing_ok=True)
