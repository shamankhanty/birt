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
                download_file(item["path"], local_root / rel, token)
                count += 1
        offset += len(items)
        if not items or offset >= embedded.get("total", offset):
            return count

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--remote", required=True, help="Yandex Disk path, e.g. disk:/.../INBOX")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    token = os.environ.get("YANDEX_DISK_TOKEN")
    if not token:
        raise SystemExit("YANDEX_DISK_TOKEN is not configured")
    args.output.mkdir(parents=True, exist_ok=True)
    count = walk(args.remote, args.output, token)
    print(f"Yandex Disk INBOX downloaded: {count} file(s)")
    if count == 0:
        print("INBOX is empty; nothing to process.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
