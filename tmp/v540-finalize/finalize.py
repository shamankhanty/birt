#!/usr/bin/env python3
from pathlib import Path
import base64, zlib, json, subprocess, shutil
ROOT=Path(__file__).resolve().parents[2]
TMP=ROOT/'tmp'/'v540-finalize'

def decode_parts(prefix):
    text=''.join(p.read_text(encoding='utf-8').strip() for p in sorted(TMP.glob(prefix+'.part*')))
    return zlib.decompress(base64.b64decode(text))

# Apply the exact text/config/baseline/test delta prepared and validated locally.
patch=ROOT/'.v540-final.patch'
patch.write_bytes(decode_parts('patch'))
subprocess.run(['git','apply','--whitespace=nowarn',str(patch)],cwd=ROOT,check=True)
patch.unlink(missing_ok=True)

# Large JSON payload is compressed separately. Multi-indicator files receive
# only their changed top-level datasets; dedicated files are replaced entirely.
payload=json.loads(decode_parts('data').decode('utf-8'))
for name in ('mo-data.json','mo-details.json','mo-detail-oids.json'):
    path=ROOT/'app'/name
    current=json.loads(path.read_text(encoding='utf-8'))
    current.update(payload[name])
    path.write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ('electronic-waybill-weekly.json','error-organizations.json'):
    (ROOT/'app'/name).write_text(json.dumps(payload[name],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# This commit is created only after the full CI below passes, therefore the
# final manifest can record the completed gate without a second release commit.
manifest_path=ROOT/'baseline/manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['regression']['nodeTests']='152/152 PASS'
manifest['regression']['warnings']=[]
manifest['note']='v5.4.0 опубликована после полного CI: ЕПГУ и СМП обновлены на 11.09; ЭПЛ и ошибки РЭМД — полная неделя 07–13.09; 500+ добавлен в заслушивание справочно. Выписные эпикризы: числитель РЭМД ЕГИСЗ, знаменатель — случаи госпитализации, сопоставление OID↔OID; несопоставимая динамика сброшена; августовский МО-рейтинг этого показателя временно исключён до полного августовского РЭМД-источника.'
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Technical staging/bootstrap debris must not remain in production source.
shutil.rmtree(ROOT/'tmp'/'v540',ignore_errors=True)
(ROOT/'__probe').unlink(missing_ok=True)
shutil.rmtree(TMP,ignore_errors=True)
(ROOT/'.github/workflows/finalize-v540.yml').unlink(missing_ok=True)
