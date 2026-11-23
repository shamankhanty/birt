/** Find medical organizations despite punctuation, whitespace and № in names. */
export const normalizeMoSearch = value => String(value ?? "")
  .toLocaleLowerCase("ru")
  .replace(/ё/g, "е")
  .replace(/[^а-яa-z0-9]/g, "");

export function matchesMoSearch(name, query) {
  return normalizeMoSearch(name).includes(normalizeMoSearch(query));
}
