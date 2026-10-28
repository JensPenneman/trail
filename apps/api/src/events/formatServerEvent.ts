import type { ServerEvent } from "@trail/contracts/events";

/**
 * One SSE message: `id:` the event's place in the user's stream (absent for
 * what only this stream is told, such as `session-ended`), the `event:` field
 * its type, `data:` the JSON (a single line).
 */
export function formatServerEvent(event: ServerEvent, id?: string): string {
  const head = id === undefined ? "" : `id: ${id}\n`;
  return `${head}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
