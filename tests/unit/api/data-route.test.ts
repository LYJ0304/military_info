import { describe, expect, it } from "vitest";

import { handleDataRequest } from "@/app/api/data/route";
import type {
  MenuPageQuery,
  MenuQueryStore,
} from "@/lib/db/repositories/menu-query-repository";

class FakeMenuQueryStore implements MenuQueryStore {
  lastQuery?: MenuPageQuery;

  constructor(
    private readonly result: Awaited<
      ReturnType<MenuQueryStore["getMenuPage"]>
    >,
  ) {}

  async getMenuPage(query: MenuPageQuery) {
    this.lastQuery = query;
    return this.result;
  }
}

describe("handleDataRequest", () => {
  it("returns a clear empty state with default pagination", async () => {
    const repository = new FakeMenuQueryStore({
      items: [],
      total: 0,
      latestRun: null,
      lastSuccessfulImportAt: null,
    });
    const response = await handleDataRequest(
      new Request("https://example.com/api/data"),
      repository,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      pagination: {
        page: 1,
        pageSize: 30,
        totalItems: 0,
        totalPages: 0,
      },
      lastImport: null,
      lastSuccessfulImportAt: null,
    });
  });

  it("passes pagination and date filters and includes import metadata", async () => {
    const completedAt = new Date("2026-07-18T00:00:00.000Z");
    const repository = new FakeMenuQueryStore({
      items: [
        {
          id: "item-1",
          mealDate: "2026-05-01",
          mealType: "LUNCH",
          menuName: "비빔밥",
          calories: "500.00",
          rawCalories: "500kcal",
        },
      ],
      total: 21,
      latestRun: {
        status: "COMPLETED",
        startedAt: completedAt,
        completedAt,
      },
      lastSuccessfulImportAt: completedAt,
    });
    const response = await handleDataRequest(
      new Request(
        "https://example.com/api/data?page=2&pageSize=10&date=2026-05-01",
      ),
      repository,
    );

    expect(repository.lastQuery).toMatchObject({
      page: 2,
      pageSize: 10,
      date: "2026-05-01",
    });
    await expect(response.json()).resolves.toMatchObject({
      pagination: { totalItems: 21, totalPages: 3 },
      lastImport: { status: "COMPLETED" },
      lastSuccessfulImportAt: "2026-07-18T00:00:00.000Z",
    });
  });

  it("rejects invalid pagination and calendar dates", async () => {
    const repository = new FakeMenuQueryStore({
      items: [],
      total: 0,
      latestRun: null,
      lastSuccessfulImportAt: null,
    });
    const response = await handleDataRequest(
      new Request(
        "https://example.com/api/data?page=0&pageSize=101&date=2026-02-30",
      ),
      repository,
    );

    expect(response.status).toBe(400);
    expect(repository.lastQuery).toBeUndefined();
  });
});
