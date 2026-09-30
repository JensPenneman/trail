import type { ServerEvent } from "@trail/contracts/events";

/** One SSE message: the `event:` field is the type, `data:` the JSON (single line). */
export function formatServerEvent(event: ServerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
