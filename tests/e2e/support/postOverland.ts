import type { APIRequestContext, APIResponse } from "@playwright/test";

/** What the iPhone app sends (the ingest log shows it). */
export const overlandUserAgent = "Overland/2025.9 CFNetwork/3860.100.1 Darwin/26.0.0";

/** Posts an upload the way Overland does: JSON with the device token as a bearer token. */
export function postOverland(
  request: APIRequestContext,
  token: string,
  body: unknown,
): Promise<APIResponse> {
  return request.post("/api/overland", {
    data: body,
    headers: { Authorization: `Bearer ${token}`, "User-Agent": overlandUserAgent },
  });
}
