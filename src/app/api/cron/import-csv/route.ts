import { verifyCronRequest } from "@/lib/auth/verify-cron";
import { importMndMenuCsv } from "@/lib/import/import-menu-csv";
import {
  MenuImportExecutionError,
  type MenuImportResult,
} from "@/lib/import/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ImportRunner = () => Promise<MenuImportResult>;

export async function handleCronImport(
  request: Request,
  runImport: ImportRunner = importMndMenuCsv,
  cronSecret: string | undefined = process.env.CRON_SECRET,
): Promise<Response> {
  const auth = verifyCronRequest(request, cronSecret);

  if (!auth.ok) {
    const misconfigured = auth.reason === "MISCONFIGURED";
    return Response.json(
      {
        error: misconfigured
          ? "Cron authentication is not configured"
          : "Unauthorized",
      },
      { status: misconfigured ? 500 : 401 },
    );
  }

  try {
    const result = await runImport();
    const concurrent =
      result.status === "SKIPPED" &&
      result.message === "Another import for this source is already running";

    return Response.json(result, { status: concurrent ? 409 : 200 });
  } catch (error) {
    if (error instanceof MenuImportExecutionError) {
      return Response.json(
        {
          status: "FAILED",
          runId: error.result.runId,
          source: error.result.source,
          checksum: error.result.checksum,
          message: "CSV import failed",
        },
        { status: 500 },
      );
    }

    return Response.json(
      { status: "FAILED", message: "CSV import failed" },
      { status: 500 },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return handleCronImport(request);
}
