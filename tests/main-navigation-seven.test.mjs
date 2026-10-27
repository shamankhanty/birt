import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/page.tsx", "utf8");
const mobile = source.slice(source.indexOf('{mobileMenuOpen && ('), source.indexOf('<div className="shell">'));
const sidebar = source.slice(source.indexOf('<p className="sideLabel">РАЗДЕЛЫ</p>'), source.indexOf('<div className="sideFoot">'));
const expected = [
  ["unified","Расширенная сводка","01"],
  ["matrix","Показатели","02"],
  ["hearings","МО для заслушивания","03"],
  ["ranking","Месячный рейтинг МО","04"],
  ["methods","Методика расчёта","05"],
  ["frmr","ФРМР ↔ ГИС","06"],
  ["remdErrors","Ошибки РЭМД","07"],
];
test("mobile primary menu has seven items in the requested sequence", () => {
  const actual = [...mobile.matchAll(/\["(unified|matrix|hearings|ranking|methods|frmr|remdErrors)", "([^"]+)", "(\d{2})"\]/g)]
    .map(x=>[x[1],x[2],x[3]]);
  assert.deepEqual(actual, expected);
  assert.match(mobile, /\["extraDivider", "Другие разделы", ""\]/);
  assert.match(mobile, /\["devDivider", "В разработке", ""\]/);
});
test("desktop primary menu mirrors mobile and brings methodology/FRMR out of development", () => {
  const groups=[...sidebar.matchAll(/<span>(\d{2})<\/span>\s*(Расширенная сводка|Показатели|МО для заслушивания|Месячный рейтинг МО|Методика расчёта|ФРМР ↔ ГИС|Ошибки РЭМД)/g)]
    .map(x=>[x[2],x[1]]);
  assert.deepEqual(groups, expected.map(x=>[x[1],x[2]]));
  assert.doesNotMatch(sidebar,/developmentSection\s+\$\{tab === "(methods|frmr)"/u);
  assert.ok(sidebar.indexOf('> ФРМР ↔ ГИС') < sidebar.indexOf('>Ошибки РЭМД') || sidebar.includes('<span>06</span> ФРМР ↔ ГИС'));
  assert.match(sidebar,/Другие разделы/);
  assert.match(sidebar,/Электронный путевой лист/);
  assert.match(sidebar,/В разработке/);
  assert.match(sidebar,/История обновлений/);
  assert.match(sidebar,/Все виды СЭМД/);
  assert.match(sidebar,/Ошибки методик/);
  assert.match(sidebar,/МАХ/);
});
test("month rating and methodology headings follow navigation; content remains available", () => {
  assert.match(source,/<h1>Месячный рейтинг МО — \{latestFullMonth.label\}<\/h1>/);
  assert.match(source,/<h1>Методика расчёта показателей<\/h1>/);
  for (const tab of ["methods","frmr","remdErrors","waybill","ranking","hearings"]) {
    assert.match(source, new RegExp('tab === "'+tab+'"'), tab);
  }
});
