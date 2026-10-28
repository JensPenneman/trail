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

  it("knows the fleet's own secrets, whatever their shape", () => {
    const fleet = { people: [{ session, devices: [{ token, deviceKey: "load-1a2b3c-7" }] }] };
    const known = secretsOf(fleet);
    assert.deepEqual(known, [session, token, "load-1a2b3c-7"]);
    assert.equal(redact("phone load-1a2b3c-7 sent", known), "phone [redacted] sent");
    assert.deepEqual(leaksIn("topic owntracks/load-1a2b3c-7", known), [
      "a secret or name of the fleet",
    ]);
    assert.deepEqual(leaksIn("p95 51.4 ms, 7 uploads", known), []);
  });
});
