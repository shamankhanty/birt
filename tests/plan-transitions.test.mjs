import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransition } from '../lib/plan-transitions.js';

test('crossings preserve both directions even with zero net change', () => {
  const rows = [{previous:94,fact:96},{previous:97,fact:94},{previous:96,fact:97}];
  assert.deepEqual(rows.map(r=>planTransition(r,95)),['reached','lost',null]);
});
test('plan threshold uses unrounded values and includes exact target', () => {
  assert.equal(planTransition({previous:94.999,fact:95},95),'reached');
  assert.equal(planTransition({previous:95,fact:94.999},95),'lost');
});
test('missing previous/current, target and changed methodology cannot create a transition', () => {
  for(const row of [{previous:null,fact:96},{fact:96},{previous:96,fact:null},{previous:94,fact:96,sourceStatus:'no_source_row'}])
    assert.equal(planTransition(row,95),null);
  assert.equal(planTransition({previous:94,fact:96},null),null);
  assert.equal(planTransition({previous:94,fact:96},95,{disabled:true}),null);
});
test('lower is better reverses the comparison', () => {
  assert.equal(planTransition({previous:6,fact:5},5,{lowerIsBetter:true}),'reached');
  assert.equal(planTransition({previous:5,fact:6},5,{lowerIsBetter:true}),'lost');
});
