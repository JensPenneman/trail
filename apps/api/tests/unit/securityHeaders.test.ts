import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../src/http/securityHeaders";

const origins = { self: ["https://imagery.example"], external: ["https://tiles.openfreemap.org"] };

const policyOf = async (externalStyles: boolean): Promise<string> => {
  const app = express()
    .use(securityHeaders(origins, externalStyles))
    .get("/", (_req, res) => res.end());
  return String((await request(app).get("/")).headers["content-security-policy"]);
};

describe("the CSP's map origins", () => {
  it("allow the external origins whenever the external styles can be used, always with 'self'", async () => {
    expect(await policyOf(true)).toContain("connect-src 'self' https://tiles.openfreemap.org;");
    expect(await policyOf(false)).toContain("connect-src 'self' https://imagery.example;");
    expect(await policyOf(false)).not.toContain("openfreemap");
  });
});
