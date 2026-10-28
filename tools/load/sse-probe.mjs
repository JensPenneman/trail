/*
 * The SSE probe (docs/design/capacity.md §6.1): k6 does not read Server-Sent
 * Events, so this does. It opens a stream per person it is given (with their
 * sessions from `trail load-fleet`), uploads one marked point at a time
 * through a phone of its own (OwnTracks for iOS, the probe's device) and
 * measures:
 *
 *   - delivery lag: from sending that upload to its `ingest` event on the
 *     probe's own stream (§3.2: p95 ≤ 1 s, p99 ≤ 3 s);
 *   - fan-out lag: from the server's `receivedAt` of any upload to its
 *     `ingest` event on any of the streams (the k6 phones' uploads);
 *   - processing lag: from the upload to the `segments` event of the window
 *     that covers it.
 *
 * Reconnects follow the stream's `retry`. Numbers only in what it writes;
 * nothing of the sessions, the token or the positions.
 *
 *   node tools/load/sse-probe.mjs --config <run>/probe.json      until SIGTERM, then <run>/probe.result.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { owntracksLocation } from "./lib/encoders.js";
import { summarize } from "./lib/stats.mjs";

/**
 * @typedef {{
 *   baseUrl: string, cookieName: string, sessions: string[],
 *   probe: { session: string, token: string, deviceKey: string, deviceId: string, lon: number, lat: number },
 *   intervalS: number, out: string,
 * }} ProbeConfig
 */

/**
 * Reads `text/event-stream` from a body: events of `event:`/`data:` lines,
 * dispatched at a blank line; comments (`: ping`) and `retry:` are kept apart.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: { type: string, data: string }) => void} onEvent
 * @param {(retryMs: number) => void} onRetry
 */
export async function readEvents(body, onEvent, onRetry) {
  const decoder = new TextDecoder();
  let buffer = "";
  let type = "message";
  /** @type {string[]} */
  let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (data.length > 0) onEvent({ type, data: data.join("\n") });
        type = "message";
        data = [];
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") type = value;
        else if (field === "data") data.push(value);
        else if (field === "retry" && /^\d+$/.test(value)) onRetry(Number(value));
      }
      newline = buffer.indexOf("\n");
    }
  }
}

/**
 * Runs the probe until `signal` aborts; resolves to what it measured.
 * @param {ProbeConfig} config
 * @param {AbortSignal} signal
 */
export async function runProbe(config, signal) {
  /** @type {Map<number, { sentAt: number, answeredAt: number | null }>} */
  const marked = new Map();
  /** @type {Map<number, number>} the probe's uploads not yet in a processed window: tst → sent at */
  const unprocessed = new Map();
  const lags = {
    delivery: /** @type {number[]} */ ([]),
    afterAnswer: /** @type {number[]} */ ([]),
    fanout: /** @type {number[]} */ ([]),
    processing: /** @type {number[]} */ ([]),
  };
  /** @type {Record<string, number>} */
  const events = {};
  const counts = {
    opened: 0,
    reconnects: 0,
    failedOpens: 0,
    uploads: 0,
    acked: 0,
    failedUploads: 0,
  };

  /**
   * @param {string} session
   * @param {boolean} own the probe's own stream
   */
  const stream = async (session, own) => {
    let retryMs = 5000;
    let first = true;
    while (!signal.aborted) {
      try {
        const response = await fetch(`${config.baseUrl}/api/events`, {
          headers: { Cookie: `${config.cookieName}=${session}`, Accept: "text/event-stream" },
          signal,
        });
        if (response.status !== 200 || response.body === null) {
          counts.failedOpens += 1;
          await response.body?.cancel();
        } else {
          counts.opened += 1;
          if (!first) counts.reconnects += 1;
          first = false;
          await readEvents(
            response.body,
            (event) => {
              const now = Date.now();
              events[event.type] = (events[event.type] ?? 0) + 1;
              if (event.type !== "ingest" && event.type !== "segments") return;
              /** @type {{ deviceId?: string, receivedAt?: string, points?: number[][], from?: string, to?: string }} */
              let payload;
              try {
                payload = JSON.parse(event.data);
              } catch {
                return;
              }
              if (event.type === "ingest") {
                const received = Date.parse(payload.receivedAt ?? "");
                if (Number.isFinite(received)) lags.fanout.push(now - received);
                if (!own || payload.deviceId !== config.probe.deviceId) return;
                for (const point of payload.points ?? []) {
                  const tst = point[2];
                  const upload = tst === undefined ? undefined : marked.get(tst);
                  if (upload === undefined || tst === undefined) continue;
                  lags.delivery.push(now - upload.sentAt);
                  if (upload.answeredAt !== null) lags.afterAnswer.push(now - upload.answeredAt);
                  marked.delete(tst);
                }
              } else if (own && payload.deviceId === config.probe.deviceId) {
                const from = Date.parse(payload.from ?? "") / 1000;
                const to = Date.parse(payload.to ?? "") / 1000;
                for (const [tst, sentAt] of unprocessed) {
                  if (tst >= from && tst <= to) {
                    lags.processing.push(now - sentAt);
                    unprocessed.delete(tst);
                  }
                }
              }
            },
            (ms) => {
              retryMs = ms;
            },
          );
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof Error)) counts.failedOpens += 1;
      }
      if (!signal.aborted) await sleep(retryMs, undefined, { signal }).catch(() => undefined);
    }
  };

  const streams = [
    stream(config.probe.session, true),
    ...config.sessions.map((session) => stream(session, false)),
  ];

  // Give the streams a moment to open, then upload a marked point every interval.
  await sleep(2000, undefined, { signal }).catch(() => undefined);
  let lastTst = 0;
  while (!signal.aborted) {
    const sentAt = Date.now();
    const tst = Math.max(lastTst + 1, Math.floor(sentAt / 1000));
    lastTst = tst;
    const point = {
      t: 0,
      lon: config.probe.lon,
      lat: config.probe.lat,
      speedMs: 0,
      course: null,
      accuracyM: 10,
      altitudeM: 9,
      motion: ["stationary"],
      battery: 0.9,
      moving: false,
      mode: null,
    };
    const request = owntracksLocation(
      "ios",
      config.probe.token,
      point,
      tst,
      config.probe.deviceKey,
    );
    marked.set(tst, { sentAt, answeredAt: null });
    unprocessed.set(tst, sentAt);
    counts.uploads += 1;
    try {
      const response = await fetch(`${config.baseUrl}${request.path}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
      });
      await response.arrayBuffer();
      const entry = marked.get(tst);
      if (entry !== undefined) entry.answeredAt = Date.now();
      if (response.status === 200) counts.acked += 1;
      else {
        counts.failedUploads += 1;
        marked.delete(tst);
        unprocessed.delete(tst);
      }
    } catch {
      if (signal.aborted) break;
      counts.failedUploads += 1;
      marked.delete(tst);
      unprocessed.delete(tst);
    }
    const wait = config.intervalS * 1000 - (Date.now() - sentAt);
    if (wait > 0) await sleep(wait, undefined, { signal }).catch(() => undefined);
  }
  await Promise.allSettled(streams);
  return {
    streams: config.sessions.length + 1,
    intervalS: config.intervalS,
    counts,
    events,
    undelivered: marked.size,
    unprocessed: unprocessed.size,
    deliveryMs: summarize(lags.delivery),
    afterAnswerMs: summarize(lags.afterAnswer),
    fanoutMs: summarize(lags.fanout),
    processingMs: summarize(lags.processing),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  if (values.config === undefined) {
    console.error("usage: node tools/load/sse-probe.mjs --config <run>/probe.json");
    process.exit(2);
  }
  /** @type {ProbeConfig} */
  const config = JSON.parse(readFileSync(values.config, "utf8"));
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort());
  process.once("SIGINT", () => abort.abort());
  const result = await runProbe(config, abort.signal);
  writeFileSync(config.out, JSON.stringify(result, null, 2));
  console.log(
    `sse-probe: ${result.streams} streams, ${result.counts.uploads} marked uploads, delivery p95 ${result.deliveryMs.p95 ?? "—"} ms`,
  );
}
