"""BIRT Local Updater 2: automatic INBOX intake using the existing staging gates."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INBOX = Path.home() / 'Yandex.Disk/!МЗ РТ/!Синк 05 08 26/BIRT/BIRT/INBOX'


def inventory(folder):
    result = {}
    for path in sorted(folder.rglob('*')):
        if not path.is_file() or path.name.startswith('~$'):
            continue
        with path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        result[path.relative_to(folder).as_posix()] = digest
    return result


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def pipeline_fingerprint():
    digest=hashlib.sha256()
    for folder in ('app','scripts','lib','config','baseline'):
        for path in sorted((ROOT/folder).rglob('*')):
            if path.is_file() and path.suffix in ('.py','.mjs','.js','.ts','.tsx','.json'):
                digest.update(path.relative_to(ROOT).as_posix().encode())
                digest.update(path.read_bytes())
    return digest.hexdigest()


class Lock:
    """OS lock is automatically released even when the process is terminated."""
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.handle = self.path.open('a+b')
        self.handle.seek(0)
        self.handle.write(b'0')
        self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            raise RuntimeError('STOP: BIRT Local Updater 2 уже запущен.')
        return self

    def __exit__(self, *args):
        self.handle.close()


def process(inbox, output, settle, force=False):
    before = inventory(inbox)
    if not before:
        print('PARTIAL: INBOX пуст; обновления не подготовлены.', flush=True)
        return 0
    state_path = output / 'state.json'
    previous = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    fingerprint=pipeline_fingerprint()
    if not force and previous.get('files') == before and previous.get('pipelineFingerprint')==fingerprint:
        print('Новых источников нет. Статус: ' + previous.get('decision', 'PARTIAL'), flush=True)
        return 2 if previous.get('decision') == 'FAIL' else 0
    time.sleep(settle)
    if inventory(inbox) != before:
        print('PARTIAL: файлы еще копируются; обновление отложено.', flush=True)
        return 3
    run = output / (datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid4().hex[:8])
    snapshot = run / 'input'
    snapshot.mkdir(parents=True)
    for name in before:
        target = snapshot / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(inbox / name, target)
    if inventory(snapshot) != before or inventory(inbox) != before:
        print('PARTIAL: источник изменился при копировании; обновление отложено.', flush=True)
        return 3
    sys.path.insert(0,str(ROOT/'scripts/pipeline'))
    from transactional_stage import stage
    try:
        report=stage(snapshot,run/'candidate',inbox.parent/'ARCHIVE/historical-replay.json')
        env={**os.environ,'DASHBOARD_APP_DIR':str(run/'candidate/app'),
             'OFFLINE_OUTPUT_DIR':str(run/'dashboard'),'OFFLINE_WORK_DIR':str(run/'build'),'PYTHON':sys.executable,
             'UPDATER_REPORT_PATH':str(run/'candidate/staging-manifest.json')}
        with (run/'build.log').open('w',encoding='utf-8') as log:
            built=subprocess.run(['node',str(ROOT/'scripts/build-offline.mjs')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        if built.returncode: raise RuntimeError('Не удалось собрать локальный дашборд; подробности в build.log')
        report['artifact']=str(run/'dashboard')
        decision=report['state']
    except Exception as error:
        (run/'pipeline.log').write_text(traceback.format_exc(),encoding='utf-8')
        report={'state':'STOP','error':str(error),'sourceCount':len(before),'indicators':[]}
        decision='STOP'
    write_json(run/'report.json',report)
    summary = {
        'name': 'BIRT Local Updater 2', 'time': datetime.now().isoformat(),
        'decision': decision, 'files': before, 'run': str(run),
        'pipelineFingerprint':fingerprint,
        'changedFiles': report.get('changedFiles', []),
        'sourceCount':report.get('sourceCount',len(before)),
        'statistics':report.get('statistics'),
        'indicators':report.get('indicators',[]),
        'unknownSources':report.get('unknownSources',[]),
        'historicalReplay':report.get('historicalReplay'),
        'error':report.get('error'),
        'applied': False, 'published': False,
        'applyBlockReason': 'Кандидат подготовлен отдельно; commit, push и публикация не выполняются.',
    }
    write_json(output / 'latest.json', summary)
    # Failures remain retryable without altering the source files.
    if decision != 'STOP':
        write_json(state_path, summary)
    from transactional_stage import indicator_statistics
    stats=summary['statistics'] or indicator_statistics(summary['indicators'])
    print(f"{decision} | Источников: {summary['sourceCount']} | Показателей всего: {stats['expectedIndicators']} | Получили источники: {stats['receivedIndicators']} | Подготовлено: {stats['preparedIndicators']} | Сохранено из-за источника: {stats['retainedInvalidIndicators']} | Без источника: {stats['missingSourceIndicators']} | Неизвестных файлов: {len(summary['unknownSources'])}\nОтчёт: {run}",flush=True)
    return 2 if decision == 'STOP' else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inbox', type=Path, default=DEFAULT_INBOX)
    parser.add_argument('--output', type=Path, default=ROOT / 'REPORTS')
    parser.add_argument('--watch', action='store_true', help='Continuously check INBOX; Ctrl+C stops.')
    parser.add_argument('--interval', type=float, default=60)
    parser.add_argument('--settle', type=float, default=10, help='Seconds to wait for source stability.')
    parser.add_argument('--force', action='store_true', help='Reprocess unchanged sources once.')
    args = parser.parse_args()
    if args.interval < 1 or args.settle < 0:
        parser.error('interval must be >= 1 and settle must be >= 0')
    inbox, output = args.inbox.resolve(), args.output.resolve()
    if not inbox.is_dir():
        parser.error(f'INBOX does not exist: {inbox}')
    if output == inbox or inbox in output.parents or output in inbox.parents:
        parser.error('INBOX and output must be separate, non-nested directories')
    output.mkdir(parents=True, exist_ok=True)
    with Lock(output / 'updater.lock'):
        force = args.force
        while True:
            try:
                code = process(inbox, output, args.settle, force)
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                write_json(output/'latest.json',{'decision':'STOP','error':str(error)})
                print('STOP: системная ошибка; подробности в REPORTS/latest.json.', file=sys.stderr, flush=True)
                code = 2
            force = False
            if not args.watch:
                return code
            time.sleep(args.interval)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\nОбновление остановлено.')
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
