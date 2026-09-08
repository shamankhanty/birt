import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('stage9 source adapters are deterministic and staging-only',()=>{
  const r=spawnSync('python3',['scripts/pipeline/adapter_selftest.py'],{encoding:'utf8'});
  assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`);
  const x=JSON.parse(r.stdout);
  assert.equal(x.status,'PASS');
  assert.equal(x.adapters,19);
  assert.equal(x.canonicalUnchanged,true);
  assert.equal(x.endToEndStaging,'PASS');
});
