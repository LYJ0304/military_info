import { describe, expect, it } from "vitest";

import { verifyCronRequest } from "@/lib/auth/verify-cron";

describe("verifyCronRequest", () => {
  it("rejects a request without an Authorization header", () => {
    const request = new Request("https://example.com/api/cron/import-csv");

    expect(verifyCronRequest(request, "test-secret")).toEqual({
      ok: false,
      reason: "UNAUTHORIZED",
    });
  });

  it("rejects an incorrect Cron secret", () => {
    const request = new Request("https://example.com/api/cron/import-csv", {
      headers: { authorization: "Bearer wrong-secret" },
    });

    expect(verifyCronRequest(request, "test-secret")).toEqual({
      ok: false,
      reason: "UNAUTHORIZED",
    });
  });

  it("reports a missing server-side secret as misconfigured", () => {
    const request = new Request("https://example.com/api/cron/import-csv");

    expect(verifyCronRequest(request, undefined)).toEqual({
      ok: false,
      reason: "MISCONFIGURED",
    });
  });
});
