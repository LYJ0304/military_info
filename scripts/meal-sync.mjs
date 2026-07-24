import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";

export const CSV_PATH = "data/OA-9561_제9030부대_식단정보.csv";
export const SOURCE_ID = "OA-9561";
export const UNIT_NAME = "제9030부대";
const NOTION_VERSION = process.env.NOTION_VERSION ?? "2025-09-03";
const mealColumns = [
  ["breakfast", "조식", "조식열량"],
  ["lunch", "중식", "중식열량"],
  ["dinner", "석식", "석식열량"],
  ["special", "증특식", "증특식열량"],
];

function parseDate(value) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\([^)]*\))?$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day));
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() + 1 !== +month || date.getUTCDate() !== +day) return null;
  return `${year}-${month}-${day}`;
}

function calories(value) {
  const text = value.trim();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:kcal)?$/i);
  if (!match) return null;
  return Number(match[1]);
}

export function decodeCsv(bytes) {
  for (const encoding of ["utf-8", "euc-kr"]) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); } catch {}
  }
  throw new Error("CSV 인코딩이 UTF-8 또는 CP949/EUC-KR이 아닙니다.");
}

export function parseDailyMeals(text) {
  const records = parse(text, { bom: true, columns: true, skip_empty_lines: true });
  if (!records.length) throw new Error("CSV에 식단 행이 없습니다.");
  const headers = ["날짜", "조식", "조식열량", "중식", "중식열량", "석식", "석식열량", "증특식", "증특식열량", "열량합계"];
  for (const header of headers) if (!(header in records[0])) throw new Error(`CSV 필수 열이 없습니다: ${header}`);

  const byDate = new Map();
  let currentDate = null;
  records.forEach((row, index) => {
    if (row["날짜"].trim()) currentDate = parseDate(row["날짜"]);
    if (!currentDate) throw new Error(`${index + 2}행의 날짜가 잘못됐습니다.`);
    if (!byDate.has(currentDate)) byDate.set(currentDate, {
      date: currentDate,
      meals: { breakfast: [], lunch: [], dinner: [], special: [] },
      mealCalories: { breakfast: 0, lunch: 0, dinner: 0, special: 0 },
      totalCalories: null,
    });
    const daily = byDate.get(currentDate);
    for (const [key, menuColumn, calorieColumn] of mealColumns) {
      const name = row[menuColumn].trim();
      const amount = calories(row[calorieColumn]);
      if (!name && amount === null) continue;
      if (!name) continue;
      daily.meals[key].push({ name, calories: amount });
      daily.mealCalories[key] = Math.round((daily.mealCalories[key] + (amount ?? 0)) * 1000) / 1000;
    }
    const total = calories(row["열량합계"]);
    if (total !== null) daily.totalCalories = total;
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mndForm() {
  return new URLSearchParams({
    txtTopSearch: "", txtTopGubun: "", txtContentSearch: "", pageNo: "1", tMenu: "Dataset", sMenu: "Dataset",
    leftFilter: "", leftSrvType: "", vinfId: SOURCE_ID, infNm: "제9030부대 식단 정보_월별", infSeq: "1",
    dtNm: "제9030부대 병영 표준 식단 정보", dsId: "TB_MNDT_DATEBYMLSVC_9030", strWhere: "", strOrderby: "",
    sortColNo: "", sortColNm: "", sortArrow: "", reurl: "",
    txtEngHeader: "dates,brst,brst_cal,lunc,lunc_cal,dinr,dinr_cal,adspcfd,adspcfd_cal,sum_cal",
    txtKorHeader: "날짜,조식,조식열량,중식,중식열량,석식,석식열량,증특식,증특식열량,열량합계",
    key: "", val: "", sel_col: "", filterCol: "필터선택", txtFilter: "",
  });
}

export async function downloadCsv(fetcher = fetch) {
  const response = await fetcher("https://opendata.mnd.go.kr/openinf/opencom/down2csv.jsp", {
    method: "POST", body: mndForm(), signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "text/csv,*/*;q=0.8", referer: "https://opendata.mnd.go.kr/openinf/sheetview2.jsp?infId=OA-9561", "user-agent": "military-info-github-action/1.0" },
  });
  if (!response.ok) throw new Error(`CSV 다운로드 실패: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("CSV 크기가 허용 범위를 벗어났습니다.");
  const text = decodeCsv(bytes);
  if (text.trimStart().startsWith("<")) throw new Error("CSV 대신 HTML 응답을 받았습니다.");
  parseDailyMeals(text);
  return bytes;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function koreanToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function selectWindow(meals, { full = false, today = koreanToday(), past = 14, future = 14 } = {}) {
  if (full) return meals;
  const from = addDays(today, -past), to = addDays(today, future);
  return meals.filter(({ date }) => date >= from && date <= to);
}

class Notion {
  constructor(token, databaseId, dataSourceId, fetcher = fetch) { Object.assign(this, { token, databaseId, dataSourceId, fetcher }); }
  async request(path, init = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await this.fetcher(`https://api.notion.com/v1${path}`, { ...init, headers: { authorization: `Bearer ${this.token}`, "notion-version": NOTION_VERSION, "content-type": "application/json", ...init.headers } });
      if (response.ok) return response.json();
      const body = (await response.text()).slice(0, 1000);
      if (attempt < 5 && (response.status === 429 || response.status >= 500)) {
        const retry = Number(response.headers.get("retry-after")); await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retry) ? retry * 1000 : 500 * 2 ** attempt)); continue;
      }
      throw new Error(`Notion API 실패 (${response.status} ${path}): ${body}`);
    }
  }
  async source() {
    if (this.dataSourceId) return this.dataSourceId;
    const database = await this.request(`/databases/${this.databaseId}`);
    const id = database.data_sources?.[0]?.id;
    if (!id) throw new Error("Notion Data Source ID를 찾지 못했습니다.");
    return id;
  }
}

const schema = { 날짜: "date", 부대: "rich_text", 조식: "rich_text", "조식 열량": "number", 중식: "rich_text", "중식 열량": "number", 석식: "rich_text", "석식 열량": "number", 증특식: "rich_text", "증특식 열량": "number", 총열량: "number", "원본 ID": "rich_text", "마지막 동기화": "date" };
const rich = (content) => ({ rich_text: (content.match(/[\s\S]{1,2000}/g) ?? []).map((chunk) => ({ type: "text", text: { content: chunk } })) });
const title = (content) => ({ title: [{ type: "text", text: { content } }] });
const names = (daily, key) => daily.meals[key].map((item) => item.name).join(", ");
export function notionProperties(daily, titleName, syncedAt) {
  return { [titleName]: title(`${UNIT_NAME} ${daily.date}`), 날짜: { date: { start: daily.date } }, 부대: rich(UNIT_NAME), 조식: rich(names(daily, "breakfast")), "조식 열량": { number: daily.mealCalories.breakfast }, 중식: rich(names(daily, "lunch")), "중식 열량": { number: daily.mealCalories.lunch }, 석식: rich(names(daily, "dinner")), "석식 열량": { number: daily.mealCalories.dinner }, 증특식: rich(names(daily, "special")), "증특식 열량": { number: daily.mealCalories.special }, 총열량: { number: daily.totalCalories }, "원본 ID": rich(SOURCE_ID), "마지막 동기화": { date: { start: syncedAt } } };
}
function textOf(property = {}) { return (property.title ?? property.rich_text ?? []).map((value) => value.plain_text ?? "").join(""); }
function same(existing, desired) {
  return Object.entries(desired).every(([name, target]) => {
    if (name === "마지막 동기화") return true;
    const current = existing[name] ?? {};
    if (target.title || target.rich_text) return textOf(current) === (target.title ?? target.rich_text).map((v) => v.text.content).join("");
    if (Object.hasOwn(target, "number")) return current.number === target.number;
    return current.date?.start === target.date?.start;
  });
}

export async function syncNotion(meals, env = process.env) {
  if (!env.NOTION_API_KEY) throw new Error("NOTION_API_KEY가 없습니다.");
  if (!env.NOTION_DATABASE_ID && !env.NOTION_DATA_SOURCE_ID) throw new Error("NOTION_DATABASE_ID 또는 NOTION_DATA_SOURCE_ID가 없습니다.");
  const notion = new Notion(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, env.NOTION_DATA_SOURCE_ID);
  const sourceId = await notion.source();
  let source = await notion.request(`/data_sources/${sourceId}`);
  const titleName = Object.entries(source.properties).find(([, value]) => value.type === "title")?.[0];
  if (!titleName) throw new Error("Notion 제목 속성을 찾지 못했습니다.");
  const missing = {};
  for (const [name, type] of Object.entries(schema)) {
    if (source.properties[name] && source.properties[name].type !== type) throw new Error(`Notion '${name}' 속성은 ${type} 형식이어야 합니다.`);
    if (!source.properties[name]) missing[name] = { [type]: {} };
  }
  if (Object.keys(missing).length) await notion.request(`/data_sources/${sourceId}`, { method: "PATCH", body: JSON.stringify({ properties: missing }) });

  const stats = { created: 0, updated: 0, unchanged: 0 };
  const syncedAt = new Date().toISOString();
  for (const daily of meals) {
    const pageTitle = `${UNIT_NAME} ${daily.date}`;
    const query = await notion.request(`/data_sources/${sourceId}/query`, { method: "POST", body: JSON.stringify({ filter: { property: titleName, title: { equals: pageTitle } }, page_size: 10 }) });
    if (query.results.length > 1) throw new Error(`중복된 Notion 페이지가 있습니다: ${pageTitle}`);
    const properties = notionProperties(daily, titleName, syncedAt), page = query.results[0];
    if (!page) { await notion.request("/pages", { method: "POST", body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: sourceId }, properties }) }); stats.created++; }
    else if (same(page.properties, properties)) stats.unchanged++;
    else { await notion.request(`/pages/${page.id}`, { method: "PATCH", body: JSON.stringify({ properties }) }); stats.updated++; }
  }
  return stats;
}

async function main() {
  const command = process.argv[2];
  if (command === "download") {
    const bytes = await downloadCsv();
    await writeFile(`${CSV_PATH}.tmp`, bytes); await rename(`${CSV_PATH}.tmp`, CSV_PATH);
    const meals = parseDailyMeals(decodeCsv(bytes));
    console.log(JSON.stringify({ status: "updated", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), firstDate: meals[0].date, lastDate: meals.at(-1).date, dates: meals.length }));
  } else if (command === "sync") {
    const meals = parseDailyMeals(decodeCsv(new Uint8Array(await readFile(CSV_PATH))));
    const selected = selectWindow(meals, { full: process.env.FULL_SYNC === "true", past: Number(process.env.SYNC_PAST_DAYS ?? 14), future: Number(process.env.SYNC_FUTURE_DAYS ?? 14) });
    if (!selected.length) return console.log(JSON.stringify({ status: "skipped", reason: "동기화 범위에 식단이 없습니다." }));
    console.log(JSON.stringify({ status: "completed", dates: selected.length, firstDate: selected[0].date, lastDate: selected.at(-1).date, ...(await syncNotion(selected)) }));
  } else throw new Error("사용법: node scripts/meal-sync.mjs <download|sync>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
