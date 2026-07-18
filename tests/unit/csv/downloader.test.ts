import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { downloadCsv } from "@/lib/csv/downloader";

describe("downloadCsv", () => {
  it("downloads bytes and calculates SHA-256 despite a wrong content type", async () => {
    const body = "날짜,조식\n2026-05-01,밥";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await downloadCsv(
      { source: "test", url: "https://example.com/data" },
      fetchMock,
    );

    expect(result.contentType).toBe("text/html");
    expect(result.checksum).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
  });

  it("rejects an HTTP error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("error", { status: 503 }));

    await expect(
      downloadCsv(
        { source: "test", url: "https://example.com/data" },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  it("rejects a response larger than the configured limit", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("123456"));

    await expect(
      downloadCsv(
        {
          source: "test",
          url: "https://example.com/data",
          maxBytes: 5,
        },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});
