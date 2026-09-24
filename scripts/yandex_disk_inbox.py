#!/usr/bin/env python3
"""Download BIRT INBOX from Yandex Disk without modifying the remote files."""
from __future__ import annotations
import argparse, json, os, sys, urllib.parse, urllib.request
from pathlib import Path

API = "https://cloud-api.yandex.net/v1/disk/resources"

def request_json(url: str, token: str):
    req = urllib.request.Request(url, headers={"Authorization": f"OAuth {token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)

def download_file(remote_path: str, local_path: Path, token: str):
    q = urllib.parse.urlencode({"path": remote_path})
    meta = request_json(f"{API}/download?{q}", token)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(meta["href"])
    with urllib.request.urlopen(req, timeout=180) as response, local_path.open("wb") as target:
        while chunk := response.read(1024 * 1024):
            target.write(chunk)

def walk(remote_path: str, local_root: Path, token: str, relative=Path(".")):
    offset = 0
    count = 0
    while True:
        q = urllib.parse.urlencode({"path": remote_path, "limit": 1000, "offset": offset, "fields": "_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.total"})
        data = request_json(f"{API}?{q}", token)
        embedded = data.get("_embedded", {})
        items = embedded.get("items", [])
        for item in items:
            rel = relative / item["name"]
            if item["type"] == "dir":
                count += walk(item["path"], local_root, token, rel)
            elif not item["name"].startswith("~$"):
                local_path = local_root / rel
                if len(item["name"].encode("utf-8")) > 240:
                    import hashlib
                    suffix = Path(item["name"]).suffix
                    stem = Path(item["name"]).stem
                    digest = hashlib.sha256(item["name"].encode("utf-8")).hexdigest()[:12]
                    safe_stem = stem.encode("utf-8")[:180].decode("utf-8", "ignore")
                    safe_name = safe_stem + "__" + digest + suffix
                    local_path = local_root / relative / safe_name
                    print(f"Long source filename mapped locally: {item['name']} -> {safe_name}")
                download_file(item["path"], local_path, token)
                count += 1
        offset += len(items)
        if not items or offset >= embedded.get("total", offset):
            return count

def request_empty(url: str, token: str, method="POST"):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"OAuth {token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.status

def archive_inbox(remote_path: str, archive_root: str, token: str):
    """Move every non-temporary top-level INBOX item after confirmed publish."""
    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    target_dir = archive_root.rstrip("/") + "/" + stamp
    q = urllib.parse.urlencode({"path": target_dir})
    try:
        request_empty(f"{API}?{q}", token, "PUT")
    except urllib.error.HTTPError as e:
        if e.code != 409:
            raise
    q = urllib.parse.urlencode({"path": remote_path, "limit": 1000, "fields": "_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.total"})
    data = request_json(f"{API}?{q}", token)
    moved = 0
    for item in data.get("_embedded", {}).get("items", []):
        if item["name"].startswith("~$"):
            continue
        dst = target_dir + "/" + item["name"]
        mq = urllib.parse.urlencode({"from": item["path"], "path": dst, "overwrite": "false"})
        request_empty(f"{API}/move?{mq}", token)
        moved += 1
    print(f"Yandex Disk INBOX archived: {moved} item(s) -> {target_dir}")
    return moved

def archive_selected(remote_path: str, archive_root: str, token: str, names: list[str]):
    """Move only explicitly verified top-level INBOX files."""
    from datetime import datetime, timezone
    if not names:
        print("Yandex Disk INBOX archived: 0 item(s); no verified files")
        return 0
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    target_dir = archive_root.rstrip("/") + "/" + stamp
    q = urllib.parse.urlencode({"path": target_dir})
    try:
        request_empty(f"{API}?{q}", token, "PUT")
    except urllib.error.HTTPError as e:
        if e.code != 409:
            raise
    q = urllib.parse.urlencode({"path": remote_path, "limit": 1000, "fields": "_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.total"})
    data = request_json(f"{API}?{q}", token)
    items = {x["name"]: x for x in data.get("_embedded", {}).get("items", [])}
    missing = [name for name in names if name not in items]
    if missing:
        raise RuntimeError("Verified INBOX file disappeared before archive: " + ", ".join(missing))
    for name in names:
        item = items[name]
        dst = target_dir + "/" + name
        mq = urllib.parse.urlencode({"from": item["path"], "path": dst, "overwrite": "false"})
        request_empty(f"{API}/move?{mq}", token)
    print(f"Yandex Disk INBOX archived: {len(names)} verified item(s) -> {target_dir}")
    return len(names)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--remote", required=True, help="Yandex Disk path, e.g. disk:/.../INBOX")
    p.add_argument("--output", type=Path)
    p.add_argument("--archive-to", help="Move current INBOX items to a timestamped directory under this remote path")
    p.add_argument("--name", action="append", default=[], help="Archive only this verified top-level INBOX filename; repeatable")
    args = p.parse_args()
    token = os.environ.get("YANDEX_DISK_TOKEN")
    if not token:
        raise SystemExit("YANDEX_DISK_TOKEN is not configured")
    if args.archive_to:
        if args.name:
            archive_selected(args.remote, args.archive_to, token, args.name)
        else:
            archive_inbox(args.remote, args.archive_to, token)
        return 0
    if args.output is None:
        raise SystemExit("--output is required unless --archive-to is used")
    args.output.mkdir(parents=True, exist_ok=True)
    count = walk(args.remote, args.output, token)
    print(f"Yandex Disk INBOX downloaded: {count} file(s)")
    if count == 0:
        print("INBOX is empty; nothing to process.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
