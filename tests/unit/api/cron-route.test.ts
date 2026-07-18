import { describe, expect, it } from "vitest";

import { handleCronImport } from "@/app/api/cron/import-csv/route";
import { MenuImportExecutionError } from "@/lib/import/types";

function authorizedRequest() {
  return new Request("https://example.com/api/cron/import-csv", {
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("handleCronImport", () => {
  it("returns 401 when the Authorization header is absent", async () => {
    const response = await handleCronImport(
      new Request("https://example.com/api/cron/import-csv"),
      async () => {
        throw new Error("must not run");
      },
      "test-secret",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns the completed import result", async () => {
    const response = await handleCronImport(
      authorizedRequest(),
      async () => ({
        runId: "run-1",
        source: "test",
        checksum: "checksum",
        status: "COMPLETED",
        totalRows: 2,
        importedRows: 2,
        failedRows: 0,
      }),
      "test-secret",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "COMPLETED",
      importedRows: 2,
    });
  });

  it("returns 409 when another source import holds the lock", async () => {
    const response = await handleCronImport(
      authorizedRequest(),
      async () => ({
        runId: "run-2",
        source: "test",
        status: "SKIPPED",
        totalRows: 0,
        importedRows: 0,
        failedRows: 0,
        message: "Another import for this source is already running",
      }),
      "test-secret",
    );

    expect(response.status).toBe(409);
  });

  it("does not expose an internal import error", async () => {
    const failedResult = {
      runId: "run-3",
      source: "test",
      status: "FAILED" as const,
      totalRows: 0,
      importedRows: 0,
      failedRows: 0,
      message: "database password secret",
    };
    const response = await handleCronImport(
      authorizedRequest(),
      async () => {
        throw new MenuImportExecutionError(
          "internal stack details",
          failedResult,
        );
      },
      "test-secret",
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe("CSV import failed");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
