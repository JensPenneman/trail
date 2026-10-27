import { apiPaths } from "@trail/contracts/apiPaths";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Agent, agentFor, signUp } from "../support/authFlows";
import { basicAuth, createDevice } from "../support/deviceFlows";
import { resetDatabase } from "../support/resetDatabase";
import { SoftwareAuthenticator } from "../support/softwareAuthenticator";
import { createTestContext, type TestContext } from "../support/testContext";
import {
  osmandQuery,
  owntracksAndroidLocation,
  traccarForm,
  traccarJson,
} from "../support/trackerSamples";

/*
 * One rule for every credential, set by the address the phones were given
 * (docs/architecture.md §6): with an https:// address, an upload over plain
 * HTTP is refused before anything is looked up, whatever carries its token.
 * The tests trust loopback as a proxy: `X-Forwarded-Proto: https` is HTTPS.
 */
let https: TestContext;
let owner: Agent;
const tokens = { overland: "", owntracks: "", traccar: "", osmand: "" };

beforeAll(async () => {
  await resetDatabase();
  https = await createTestContext({
    env: {
      INGEST_BASE_URL: "https://trail.example.test",
      // One unknown token per address: a refusal before the lookup never counts.
      RATE_LIMIT_INGEST_FAILED_PER_10_MINUTES: "1",
    },
  });
  owner = agentFor(https.app);
  await signUp(owner, new SoftwareAuthenticator(), "first@example.com");
  for (const source of ["overland", "owntracks", "traccar", "osmand"] as const) {
    const created = await createDevice(owner, { name: `Phone with ${source}`, source });
    tokens[source] = created.credentials.accessToken;
  }
});

afterAll(async () => {
  await https.close();
});

const minutesAgo = (minutes: number) =>
  new Date(Math.floor(Date.now() / 1000) * 1000 - minutes * 60_000);

/** Every way each endpoint takes a token, as the apps send it. */
const uploads = () => [
  request(https.app)
    .post(apiPaths.overland)
    .set("Authorization", `Bearer ${tokens.overland}`)
    .send({ locations: [] }),
  request(https.app).get(`${apiPaths.overland}?token=${tokens.overland}`),
  request(https.app)
    .post(apiPaths.owntracks)
    .set("Authorization", basicAuth("pixel", tokens.owntracks))
    .send(JSON.stringify(owntracksAndroidLocation(minutesAgo(10)))),
  request(https.app)
    .post(apiPaths.owntracks)
    .set("Authorization", `Bearer ${tokens.owntracks}`)
    .send(JSON.stringify(owntracksAndroidLocation(minutesAgo(9)))),
  request(https.app)
    .post(apiPaths.osmand)
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(traccarForm(tokens.traccar, minutesAgo(8))),
  request(https.app)
    .post(apiPaths.osmand)
    .set("Content-Type", "application/json")
    .send(traccarJson(tokens.traccar, minutesAgo(7))),
  request(https.app).get(`${apiPaths.osmand}?${osmandQuery(tokens.osmand, minutesAgo(6))}`),
];

describe("uploads to an https:// address", () => {
  it("are refused over plain HTTP whatever carries the token, before any lookup", async () => {
    for (const upload of uploads()) {
      const response = await upload.expect(403);
      expect(response.body.error).toMatch(
        /^Uploads need HTTPS: use https:\/\/trail\.example\.test\/api\//,
      );
    }
    // Unknown tokens too: refused before the lookup, so the failed-token budget of 1 stays unused.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(https.app)
        .get(`${apiPaths.osmand}?token=trl_${"Q".repeat(43)}`)
        .expect(403);
    }
  });

  it("are taken over HTTPS, as a trusted proxy reports it", async () => {
    for (const upload of uploads()) {
      await upload.set("X-Forwarded-Proto", "https").expect(200);
    }
  });

  it("are refused when only an untrusted proxy claims HTTPS", async () => {
    const untrusted = await createTestContext({
      env: { INGEST_BASE_URL: "https://trail.example.test", TRUST_PROXY: "" },
    });
    try {
      await request(untrusted.app)
        .post(apiPaths.owntracks)
        .set("Authorization", basicAuth("pixel", tokens.owntracks))
        .set("X-Forwarded-Proto", "https")
        .send("{}")
        .expect(403);
    } finally {
      await untrusted.close();
    }
  });
});
