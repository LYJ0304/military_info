import { timingSafeEqual } from "node:crypto";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "MISCONFIGURED" | "UNAUTHORIZED" };

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function verifyCronRequest(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuthResult {
  if (!secret) {
    return { ok: false, reason: "MISCONFIGURED" };
  }

  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;

  if (!authorization || !safeEqual(authorization, expected)) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }

  return { ok: true };
}
