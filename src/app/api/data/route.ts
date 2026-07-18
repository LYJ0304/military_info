import { z } from "zod";

import {
  MenuQueryRepository,
  type MenuQueryStore,
} from "@/lib/db/repositories/menu-query-repository";
import { MND_MENU_SOURCE } from "@/lib/import/import-menu-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day
      );
    }, "Invalid calendar date")
    .optional(),
});

export async function handleDataRequest(
  request: Request,
  repository: MenuQueryStore = new MenuQueryRepository(),
): Promise<Response> {
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json(
      {
        error: "Invalid query parameters",
        fields: parsedQuery.error.issues.map((issue) => issue.path.join(".")),
      },
      { status: 400 },
    );
  }

  try {
    const result = await repository.getMenuPage({
      source: MND_MENU_SOURCE,
      ...parsedQuery.data,
    });
    const totalPages =
      result.total === 0
        ? 0
        : Math.ceil(result.total / parsedQuery.data.pageSize);

    return Response.json({
      data: result.items,
      pagination: {
        page: parsedQuery.data.page,
        pageSize: parsedQuery.data.pageSize,
        totalItems: result.total,
        totalPages,
      },
      lastImport: result.latestRun,
      lastSuccessfulImportAt: result.lastSuccessfulImportAt,
    });
  } catch {
    return Response.json(
      { error: "Failed to load menu data" },
      { status: 500 },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return handleDataRequest(request);
}
