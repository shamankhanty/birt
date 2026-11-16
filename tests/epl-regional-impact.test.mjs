import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  excludeWaybillGroupsWithoutTransport,
  rankWaybillByRegionalImpact,
  waybillRegionalNonMovementImpact,
  waybillOrganizationNoMovementPercent,
  waybillUnrecordedMovement,
} from '../lib/electronic-waybill-scope.js';

const weekly = JSON.parse(fs.readFileSync(new URL('../app/electronic-waybill-weekly.json', import.meta.url),'utf8'));
const monthly = JSON.parse(fs.readFileSync(new URL('../app/electronic-waybill.json', import.meta.url),'utf8'));

for (const [period, slice, regionalTotal] of [
  ['неделя 09–15.11', weekly.current, weekly.current.systemSummary.vehicles],
  ['октябрь', monthly, monthly.summary.vehicles],
]) {
  test(`ЭПЛ: вклад в региональную долю и состав топ-10 — ${period}`, () => {
    const rows = excludeWaybillGroupsWithoutTransport(slice.rows);
    const ranked = rankWaybillByRegionalImpact(rows,regionalTotal);
    assert.equal(ranked.length,10);
    assert.equal(ranked[0].sourceNumber,period.startsWith('неделя')?123:110);
    assert.ok(ranked.every(row=>row.vehicles>0 && row.moved<row.vehicles));
    assert.ok(ranked.every((row,index)=>index===0 ||
      waybillUnrecordedMovement(ranked[index-1])>=waybillUnrecordedMovement(row)),
      'the largest number of vehicles without registered movement must rank first');
    assert.ok(Math.abs(waybillRegionalNonMovementImpact(ranked[0],regionalTotal)-
      ((ranked[0].vehicles-ranked[0].moved)/regionalTotal*100))<1e-12);
    assert.ok(Math.abs(waybillOrganizationNoMovementPercent(ranked[0]) -
      ((ranked[0].vehicles-ranked[0].moved)/ranked[0].vehicles*100))<1e-12);
    const regionalIdle = regionalTotal - (slice.systemSummary?.vehiclesWithMovement ?? slice.summary?.vehiclesWithMovement);
    assert.equal(rows.reduce((sum,row)=>sum+(row.vehicles-row.moved),0),regionalIdle);
    const allPp = rows.reduce((sum,row)=>sum+waybillRegionalNonMovementImpact(row,regionalTotal),0);
    assert.ok(Math.abs(allPp-regionalIdle/regionalTotal*100)<1e-9);
  });
}

test('ЭПЛ: долгий ноль не обгоняет больший региональный вклад', () => {
  const rows=[
    {sourceNumber:1,name:'Малая МО',vehicles:2,moved:0,movementShare:0},
    {sourceNumber:2,name:'Большая МО',vehicles:100,moved:30,movementShare:30},
    {sourceNumber:3,name:'Нет транспорта',vehicles:0,moved:0,movementShare:null},
  ];
  assert.deepEqual(rankWaybillByRegionalImpact(rows,102).map(x=>x.sourceNumber),[2,1]);
});

test('ЭПЛ: отсутствующие компоненты и знаменатель не превращаются в нули', () => {
  for(const row of [{vehicles:null,moved:0},{vehicles:10,moved:null},{vehicles:5,moved:6}]) {
    assert.equal(waybillUnrecordedMovement(row),null);
    assert.equal(waybillRegionalNonMovementImpact(row,100),null);
    assert.equal(waybillOrganizationNoMovementPercent(row),null);
  }
  assert.equal(waybillRegionalNonMovementImpact({vehicles:10,moved:0},null),null);
  assert.deepEqual(rankWaybillByRegionalImpact([{vehicles:10,moved:0}],null),[]);
});

test('ЭПЛ: UI показывает влияние по обоим периодам, а не приоритет двух нулевых недель', () => {
  const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/rankWaybillByRegionalImpact\(waybillComparable, waybillRegionalVehicles\)/);
  assert.match(page,/Влияние, п\.п\. = ТС МО без зафиксированного движения/);
  assert.match(page,/influence === null \? "Нет данных"/);
  assert.doesNotMatch(page,/if \(ap !== bp\) return bp - ap/);
});

test('ЭПЛ: процент отсутствия движения рассчитывается внутри МО', () => {
  assert.equal(waybillOrganizationNoMovementPercent({vehicles:50,moved:35}),30);
  assert.equal(waybillOrganizationNoMovementPercent({vehicles:7,moved:0}),100);
  assert.equal(waybillOrganizationNoMovementPercent({vehicles:7,moved:7}),0);
  assert.equal(waybillOrganizationNoMovementPercent({vehicles:0,moved:0}),null);
  const row={vehicles:20,moved:5};
  assert.equal(waybillOrganizationNoMovementPercent(row),75);
  assert.equal(waybillRegionalNonMovementImpact(row,200),7.5);
});

test('ЭПЛ: UI показывает долю МО и вклад в РТ в разных единицах', () => {
  const page=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/waybillOrganizationNoMovementPercent\(row\)/);
  assert.match(page,/\$\{format\(localPercent, 1\)\}% без движения/);
  assert.match(page,/\$\{format\(influence, 2\)\} п\.п\./);
  assert.match(page,/Процент МО = ТС МО без движения \/ все ТС этой МО/);
});
