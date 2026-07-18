import { z } from "zod";

const openApiEnvSchema = z.object({
  OPENAPI_BASE_URL: z.url(),
  OPENAPI_API_KEY: z.string().min(1),
});

export async function fetchOpenApi<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const env = openApiEnvSchema.parse(process.env);
  const url = new URL(path, env.OPENAPI_BASE_URL);

  url.searchParams.set("serviceKey", env.OPENAPI_API_KEY);

  const response = await fetch(url, {
    ...init,
    next: { revalidate: 300, ...init?.next },
  });

  if (!response.ok) {
    throw new Error(`OpenAPI request failed: ${response.status}`);
  }

  return schema.parse(await response.json());
}
