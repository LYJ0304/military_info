import assert from "node:assert/strict";
import test from "node:test";
import { notionProperties, parseDailyMeals, selectWindow } from "../../../scripts/meal-sync.mjs";

const csv = `날짜,조식,조식열량,중식,중식열량,석식,석식열량,증특식,증특식열량,열량합계
"2026-07-24(금)","쌀밥","306kcal","찹쌀죽","169.59kcal","잡곡밥","312.38kcal","","","2755.84kcal"
"","조랭이떡국","218.7kcal","삼계탕","335.97kcal","짬뽕탕","189.61kcal","","",""
"","배추김치","14kcal","배추김치","14kcal","배추김치","14kcal","","",""
"2026-07-25","밥","300kcal","","","","","","","300kcal"
`;

test("groups rows and carries forward an omitted date", () => {
  const meals = parseDailyMeals(csv);
  assert.equal(meals.length, 2);
  assert.deepEqual(meals[0].mealCalories, { breakfast: 538.7, lunch: 519.56, dinner: 515.99, special: 0 });
  assert.deepEqual(meals[0].meals.breakfast.map(({ name }) => name), ["쌀밥", "조랭이떡국", "배추김치"]);
});

test("selects a bounded window and supports a full sync", () => {
  const meals = parseDailyMeals(csv);
  assert.deepEqual(selectWindow(meals, { today: "2026-07-25", past: 0, future: 0 }).map(({ date }) => date), ["2026-07-25"]);
  assert.equal(selectWindow(meals, { full: true }).length, 2);
});

test("builds structured Notion properties", () => {
  const [meal] = parseDailyMeals(csv);
  const properties = notionProperties(meal, "이름", "2026-07-24T00:00:00.000Z");
  assert.deepEqual(properties["조식 열량"], { number: 538.7 });
  assert.deepEqual(properties["총열량"], { number: 2755.84 });
  assert.equal(properties["원본 ID"].rich_text[0].text.content, "OA-9561");
});
