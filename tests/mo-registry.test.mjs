import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../app/mo-registry.json", import.meta.url), "utf8"));

const numberTokens = value => [...String(value).matchAll(/№\s*(\d+)/gu)].map(match => match[1]);

test("registry has one deterministic group for every master MO", () => {
  assert.equal(registry.organizations.length, 127);
  assert.equal(registry.organizations.filter(org => org.type === "Другие медицинские организации").length, 0);
  assert.deepEqual(
    Object.fromEntries([...new Set(registry.organizations.map(org => org.type))].sort().map(type => [type, registry.organizations.filter(org => org.type === type).length])),
    {
      "Вне рейтинга": 4,
      "Городские больницы": 10,
      "Городские поликлиники": 11,
      "Детские городские поликлиники": 15,
      "Республиканские и специализированные МО": 33,
      "Стоматологические поликлиники": 7,
      "Центральные районные больницы": 47,
    },
  );
});

test("numbered facilities never receive an alias with another number", () => {
  const conflicts = [];
  for (const org of registry.organizations) {
    const target = new Set(numberTokens(`${org.name} ${org.shortName}`));
    for (const alias of org.aliases) {
      const source = new Set(numberTokens(alias));
      if (source.size && target.size && [...source].some(number => !target.has(number))) {
        conflicts.push({ organization: org.shortName, alias });
      }
    }
  }
  assert.deepEqual(conflicts, []);
});

test("non-comparable dispatch and ambulance entities are excluded from ranking", () => {
  const excluded = registry.organizations.filter(org => org.type === "Вне рейтинга").map(org => org.shortName).sort();
  assert.deepEqual(excluded, ["АССМП", "ДЦ МЗ РТ г.Казань", "ССМП г.Казань", "ССМП г.Наб.Челны"].sort());
});

test("unresolved source names stay explicit instead of being guessed", () => {
  assert.deepEqual(registry.unresolved, [{
    sheet: "амбулаторные эпикризы",
    name: "ГАУЗ \"Центр общественного здоровья и медицинской профилактики\" (ЦОЗ и МП) г. Нижнекамск",
    reason: "unresolved",
  }]);
  assert.match(registry.normalizationRule, /нечеткое сопоставление запрещено/u);
});
