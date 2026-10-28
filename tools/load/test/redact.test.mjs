import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leaksIn, redact, secretsOf } from "../lib/redact.js";

const token = `trl_${"Ab9_-".repeat(8)}xyz`;
const session = "S".repeat(43);

describe("redaction", () => {
  it("takes tokens, sessions, addresses, positions and credentials out of a log line", () => {
    const line = [
      `WARN Request Failed error="Get \\"http://app:8080/api/osmand?token=${token}&lat=51.05430&lon=3.71740&timestamp=1\\": EOF"`,
      `cookie: trail_session=${session}`,
      "account load-1a2b3c-7@load.invalid",
      'headers {"Authorization": "Bearer abc.def"}',
      "api trlk_0123456789abcdefghijKLMNOP and link trls_0123456789abcdefghijKLMNOP",
    ].join("\n");
    const clean = redact(line);
    assert.equal(leaksIn(clean).length, 0, clean);
    assert.ok(!clean.includes(token) && !clean.includes(session) && !clean.includes("51.05430"));
    assert.ok(clean.includes("lat=[redacted]") && clean.includes("trail_session=[redacted]"));
    assert.deepEqual(leaksIn(line).sort(), [
      "API token",
      "address",
      "authorization",
      "device token",
      "position",
      "session",
      "share link secret",
    ]);
  });

  it("takes positions out of JSON and forms, and a secret split between two chunks", async () => {
    const json =
      '{"_type":"location","lat":51.0543,"lon":3.7174,"geometry":{"coordinates":[3.7,51.04]}}';
    assert.equal(leaksIn(redact(json)).length, 0, redact(json));
    assert.equal(leaksIn(redact("lat=51.05&lon=3.71&timestamp=1")).length, 0);
    const { redactedLines } = await import("../lib/compose.mjs");
    /** @type {string[]} */
    const written = [];
    const lines = redactedLines({ write: (/** @type {string} */ text) => written.push(text) }, []);
    // Two chunks of output split the token; the line is redacted whole.
    lines.write(`url ?token=${token.slice(0, 10)}`);
    lines.write(`${token.slice(10)}&lat=1\nnext `);
    lines.flush();
    const shown = written.join("");
    assert.ok(!shown.includes(token.slice(10)), shown);
    assert.equal(shown, "url ?token=[redacted]&lat=[redacted]\nnext \n");
  });

  it("knows the fleet's own secrets, whatever their shape", () => {
    const fleet = { people: [{ session, devices: [{ token, deviceKey: "load-1a2b3c-7" }] }] };
    const known = secretsOf(fleet);
    assert.deepEqual(known, [
      session,
      token,
      "load-1a2b3c-7",
      Buffer.from(`load-1a2b3c-7:${token}`).toString("base64"),
    ]);
    assert.equal(redact("phone load-1a2b3c-7 sent", known), "phone [redacted] sent");
    assert.deepEqual(leaksIn("topic owntracks/load-1a2b3c-7", known), [
      "a secret or name of the fleet",
    ]);
    assert.deepEqual(leaksIn("p95 51.4 ms, 7 uploads", known), []);
  });
});
