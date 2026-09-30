import type { AlertConfig } from "../config/config";
import type { AlertSender } from "./alert";

const requestTimeoutMs = 10_000;

/* HTTP header values must be ASCII; ntfy decodes RFC 2047 encoded-words, which
 * keeps device names like "Jens’s iPhone" intact in the notification title. */
const headerValue = (value: string): string =>
  /^[ -~]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

/** Publishes alerts to an ntfy topic (message body + Title/Tags/Priority headers). */
export function createNtfySender(config: AlertConfig): AlertSender {
  return async (alert) => {
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      Title: headerValue(alert.title),
      Tags: alert.tags.join(","),
      Priority: alert.priority,
    };
    if (config.token !== null) headers["Authorization"] = `Bearer ${config.token}`;
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: alert.message,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`ntfy answered ${response.status} ${response.statusText}`);
    }
    // Drain the body so the connection can be reused.
    await response.arrayBuffer();
  };
}
