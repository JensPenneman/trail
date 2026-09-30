import { type ServerEvent, serverEventSchema } from "@trail/contracts/events";

/** The JSON `data:` of one stream message, validated; null when it is not a known event. */
export function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = serverEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
