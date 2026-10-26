// Private staff records are read only from the user's local device.
// No fetch, upload, browser storage, remote library or network request is used here.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_XML_BYTES = 12 * 1024 * 1024;
const encoder = new TextDecoder("utf-8");

function xml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("Повреждена XML-структура Excel.");
  }
  return doc;
}

function cellValue(cell, shared) {
  const kind = cell.getAttribute("t") || "";
  const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
  if (kind === "s") return shared[Number(value)] ?? "";
  if (kind === "inlineStr") {
    return [...cell.getElementsByTagNameNS("*", "t")].map((t) => t.textContent ?? "").join("");
  }
  return value;
}

function sheetRows(content, shared) {
  const doc = xml(content);
  const rows = [];
  for (const row of doc.getElementsByTagNameNS("*", "row")) {
    const result = { __row: Number(row.getAttribute("r") || 0) };
    for (const cell of row.getElementsByTagNameNS("*", "c")) {
      const ref = cell.getAttribute("r") || "";
      const col = ref.match(/^[A-Z]+/)?.[0];
      if (col) result[col] = cellValue(cell, shared);
    }
    rows.push(result);
    if (rows.length > 10000) throw new Error("Слишком много строк в персональной ведомости.");
  }
  return rows;
}

function zipIndex(bytes) {
  const view = new DataView(bytes);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Файл не является корректным XLSX.");
  const count = view.getUint16(eocd + 10, true);
  const start = view.getUint32(eocd + 16, true);
  const index = new Map();
  let ptr = start;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("Ошибка структуры архива XLSX.");
    const method = view.getUint16(ptr + 10, true);
    const packed = view.getUint32(ptr + 20, true);
    const unpacked = view.getUint32(ptr + 24, true);
    const nameSize = view.getUint16(ptr + 28, true);
    const extraSize = view.getUint16(ptr + 30, true);
    const commentSize = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = encoder.decode(new Uint8Array(bytes, ptr + 46, nameSize));
    index.set(name, { method, packed, unpacked, localOffset });
    ptr += 46 + nameSize + extraSize + commentSize;
    if (ptr > bytes.byteLength) throw new Error("Некорректная длина архива XLSX.");
  }
  return { index, view, bytes };
}

async function zipText(archive, path) {
  const entry = archive.index.get(path);
  if (!entry) throw new Error("В Excel отсутствует лист " + path + ".");
  if (entry.unpacked > MAX_XML_BYTES) throw new Error("Лист Excel слишком большой для локального просмотра.");
  const at = entry.localOffset;
  if (archive.view.getUint32(at, true) !== 0x04034b50) throw new Error("Повреждён архив XLSX.");
  const nameSize = archive.view.getUint16(at + 26, true);
  const extraSize = archive.view.getUint16(at + 28, true);
  const from = at + 30 + nameSize + extraSize;
  if (from + entry.packed > archive.bytes.byteLength) throw new Error("Повреждённые данные XLSX.");
  const compressed = archive.bytes.slice(from, from + entry.packed);
  if (entry.method === 0) return encoder.decode(compressed);
  if (entry.method !== 8) throw new Error("Неподдерживаемое сжатие файла XLSX.");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Этот браузер не поддерживает локальное чтение XLSX. Используйте актуальный Chrome или Edge.");
  }
  const decompressed = await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  ).arrayBuffer();
  if (decompressed.byteLength > MAX_XML_BYTES) throw new Error("Лист Excel превышает допустимый размер.");
  return encoder.decode(decompressed);
}

function maskSnils(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 ? "••• ••• " + digits.slice(6, 9) + " " + digits.slice(9) : "скрыт";
}

function decodePrivateSheets(overview, details, shared, expectedOid, expectedCount) {
  const summaryRows = sheetRows(overview, shared);
  const sourceOid = String(summaryRows.find((row) => row.__row === 4)?.B || "").trim();
  const fullOid = expectedOid.startsWith("1.2.643.")
    ? expectedOid : "1.2.643.5.1.13.13.12.2.16." + expectedOid;
  if (sourceOid !== fullOid) {
    throw new Error("Выбранная МО не совпадает с МО персональной ведомости. Проверьте файл и организацию.");
  }
  const cutDate = String(summaryRows.find((row) => row.__row === 5)?.B || "");
  if (cutDate !== "22.10.2026") {
    throw new Error("Дата локальной ведомости не совпадает с текущим опубликованным срезом 22.10.2026.");
  }
  const list = sheetRows(details, shared);
  const header = list[0] || {};
  const required = { B: "СНИЛС", E: "Должность ФРМР", F: "Подразделение ФРМР", I: "Тип расхождения" };
  for (const [col, title] of Object.entries(required)) {
    if (header[col] !== title) throw new Error("Неверный формат листа «Список для исправления»: " + title + ".");
  }
  const records = list.slice(1).filter((x) => x.B && x.I).map((x) => ({
    snils: String(x.B).replace(/\D/g, ""),
    frmrName: x.C === "Отсутствует в исходнике" ? "" : String(x.C || ""),
    scheduleName: x.D === "Не установлено" ? "" : String(x.D || ""),
    position: String(x.E || ""),
    department: String(x.F || ""),
    departmentOid: String(x.G || ""),
    employment: String(x.H || ""),
    issue: String(x.I || ""),
    gisMatch: String(x.J || ""),
    gisPositions: String(x.K || ""),
    gisDepartments: String(x.L || ""),
    schedule: String(x.M || ""),
    action: String(x.N || ""),
    status: String(x.O || "Не проверено"),
    row: String(x.Q || ""),
  }));
  if (records.length !== expectedCount) {
    throw new Error("Ведомость содержит " + records.length + " записей, а в сводке МО " + expectedCount + ". Проверьте дату и источник.");
  }
  if (records.some((r) => r.snils.length !== 11)) {
    throw new Error("В локальной ведомости есть некорректные идентификаторы сотрудников.");
  }
  return { organizationOid: sourceOid, cutDate, records, maskSnils };
}

/**
 * Parse only the locally supplied private per-MO XLSX generated from the approved
 * 22.10 snapshot. It never receives data from a server and never sends results out.
 */
export async function parseLocalPrivateFrmr(file, expectedOid, expectedCount) {
  if (!file || !/\.xlsx$/i.test(file.name)) {
    throw new Error("Выберите персональную ведомость медицинской организации в формате XLSX.");
  }
  if (file.size > MAX_FILE_BYTES) throw new Error("Локальная ведомость превышает 15 МБ.");
  const bytes = await file.arrayBuffer();
  const archive = zipIndex(bytes);
  const workbook = await zipText(archive, "xl/workbook.xml");
  if (!workbook.includes("Список для исправления")) {
    throw new Error("Файл не является утверждённой персональной ведомостью ФРМР ↔ ГИС.");
  }
  const strings = archive.index.has("xl/sharedStrings.xml")
    ? [...xml(await zipText(archive, "xl/sharedStrings.xml")).getElementsByTagNameNS("*", "si")].map(
        (si) => [...si.getElementsByTagNameNS("*", "t")].map((n) => n.textContent ?? "").join("")
      )
    : [];
  return decodePrivateSheets(
    await zipText(archive, "xl/worksheets/sheet1.xml"),
    await zipText(archive, "xl/worksheets/sheet2.xml"),
    strings, expectedOid, expectedCount
  );
}

export { maskSnils };