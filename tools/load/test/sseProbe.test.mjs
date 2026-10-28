import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { readEvents, runProbe } from "../sse-probe.mjs";

const probeSession = "p".repeat(43);
const otherSession = "o".repeat(43);
const token = `trl_${"t".repeat(43)}`;
const probeDevice = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";

/** A stream of text as a body. @param {string[]} parts */
const bodyOf = (parts) =>
  new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });

describe("the SSE probe", () => {
  it("reads event streams: events, multi-line data, comments and retry", async () => {
    /** @type {{ type: string, data: string }[]} */
    const events = [];
    /** @type {number[]} */
    const retries = [];
    await readEvents(
      bodyOf([
        "retry: 5000\n\nevent: hel",
        "lo\ndata: {}\n\n: ping\n\n",
        "data: a\ndata: b\r\n\nevent: ingest\n",
        'data: {"x":1}\n\n',
      ]),
      (event) => events.push(event),
      (ms) => retries.push(ms),
    );
    assert.deepEqual(events, [
      { type: "hello", data: "{}" },
      { type: "message", data: "a\nb" },
      { type: "ingest", data: '{"x":1}' },
    ]);
    assert.deepEqual(retries, [5000]);
  });

  it("measures delivery, fan-out and processing lags against a server, and keeps no secret", async () => {
    /** @type {Map<string, import("node:http").ServerResponse>} */
    const streams = new Map();
    let uploads = 0;
    const server = createServer((req, res) => {
      const cookie = req.headers.cookie ?? "";
      if (req.url === "/api/events") {
        const session = cookie.split("=")[1] ?? "";
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("retry: 200\n\nevent: hello\ndata: {}\n\n");
        streams.set(session, res);
        return;
      }
      if (req.url === "/api/owntracks" && req.headers.authorization === `Bearer ${token}`) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const message = JSON.parse(body);
          uploads += 1;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("[]");
          const receivedAt = new Date().toISOString();
          const ingest = {
            type: "ingest",
            deviceId: probeDevice,
            receivedAt,
            points: [[message.lon, message.lat, message.tst, 0, 10, 9]],
          };
          streams.get(probeSession)?.write(`event: ingest\ndata: ${JSON.stringify(ingest)}\n\n`);
          streams
            .get(otherSession)
            ?.write(`event: ingest\ndata: ${JSON.stringify({ ...ingest, deviceId: "other" })}\n\n`);
          if (uploads % 2 === 0) {
            const at = new Date(message.tst * 1000);
            const segments = {
              type: "segments",
              deviceId: probeDevice,
              from: new Date(at.getTime() - 60_000).toISOString(),
              to: at.toISOString(),
            };
            streams
              .get(probeSession)
              ?.write(`event: segments\ndata: ${JSON.stringify(segments)}\n\n`);
          }
        });
        return;
      }
      res.writeHead(401).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const abort = new AbortController();
    const running = runProbe(
      {
        baseUrl: `http://127.0.0.1:${port}`,
        cookieName: "trail_session",
        sessions: [otherSession],
        probe: {
          session: probeSession,
          token,
          deviceKey: "load-abc123-11",
          deviceId: probeDevice,
          lon: 3.71,
          lat: 51.03,
        },
        intervalS: 0.1,
        out: "",
      },
      abort.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    abort.abort();
    const result = await running;
    for (const stream of streams.values()) stream.end();
    server.closeAllConnections();
    server.close();

    assert.equal(result.streams, 2);
    assert.equal(result.events["hello"], 2);
    assert.ok(
      result.counts.uploads >= 5 && result.counts.acked >= 5,
      JSON.stringify(result.counts),
    );
    assert.ok(result.deliveryMs.n >= 5 && (result.deliveryMs.p95 ?? 1e9) < 1000);
    assert.ok(result.fanoutMs.n >= 10, "both streams' events count for the fan-out");
    assert.ok(result.processingMs.n >= 2);
    const kept = JSON.stringify(result);
    for (const secret of [probeSession, otherSession, token, "51.03", "3.71"])
      assert.ok(!kept.includes(secret), secret);
  });
});
