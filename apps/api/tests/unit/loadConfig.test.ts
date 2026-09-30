import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config/loadConfig";
import { parseTrustProxy } from "../../src/config/parseTrustProxy";

const defaults = { webDistDir: "/srv/web/dist" };
const minimal = {
  DATABASE_URL: "postgres://trail:trail@db:5432/trail",
  PUBLIC_URL: "https://trail.example.com/",
};

const issuesOf = (environment: NodeJS.ProcessEnv): readonly string[] => {
  try {
    loadConfig(environment, defaults);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
};

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig({ ...minimal, NODE_ENV: "production" }, defaults);
    expect(config).toMatchObject({
      isProduction: true,
      port: 8080,
      host: "0.0.0.0",
      publicUrl: "https://trail.example.com",
      allowedOrigins: ["https://trail.example.com"],
      ingestUrl: "https://trail.example.com/api/overland",
      signupAllowlist: [],
      trustProxy: "loopback, linklocal, uniquelocal",
      sessionTtlDays: 30,
      liveWindowMinutes: 15,
      staleAfterHours: 12,
      alerts: null,
      defaultTimezone: "Europe/Brussels",
      mapStyles: {
        light: "https://tiles.openfreemap.org/styles/liberty",
        dark: "https://tiles.openfreemap.org/styles/dark",
      },
      mapOrigins: ["https://tiles.openfreemap.org"],
      webDistDir: "/srv/web/dist",
      logLevel: "info",
      build: { commit: "dev", builtAt: null },
      rateLimits: {
        authPerMinute: 20,
        apiPerMinute: 600,
        ingestPerMinute: 300,
        ingestFailedPer10Minutes: 30,
      },
    });
  });

  it("treats empty variables as unset and parses lists", () => {
    const config = loadConfig(
      {
        ...minimal,
        NODE_ENV: "production",
        INGEST_BASE_URL: "",
        ADDITIONAL_ORIGINS: "http://localhost:8080, https://trail.example.com",
        SIGNUP_ALLOWLIST: " Jens@Example.com ,*@family.example ",
        MAP_STYLE_DARK: "https://maps.example.net/dark.json",
        ALERT_NTFY_URL: "https://ntfy.sh/trail-alerts",
        BUILD_TIME: "2026-09-30T19:41:07Z",
      },
      defaults,
    );
    expect(config.allowedOrigins).toEqual(["https://trail.example.com", "http://localhost:8080"]);
    expect(config.ingestUrl).toBe("https://trail.example.com/api/overland");
    expect(config.signupAllowlist).toEqual(["jens@example.com", "*@family.example"]);
    expect(config.mapOrigins).toEqual([
      "https://tiles.openfreemap.org",
      "https://maps.example.net",
    ]);
    expect(config.alerts).toEqual({ url: "https://ntfy.sh/trail-alerts", token: null });
    expect(config.build.builtAt).toBe("2026-09-30T19:41:07.000Z");
  });

  it("uses INGEST_BASE_URL for the endpoint shown to phones", () => {
    const config = loadConfig(
      { ...minimal, NODE_ENV: "production", INGEST_BASE_URL: "http://192.168.1.20:8080/" },
      defaults,
    );
    expect(config.ingestUrl).toBe("http://192.168.1.20:8080/api/overland");
  });

  it("reports every invalid variable", () => {
    const issues = issuesOf({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://nope",
      PUBLIC_URL: "https://trail.example.com/app",
      PORT: "99999",
      SIGNUP_ALLOWLIST: "not-an-email",
      DEFAULT_TIMEZONE: "Mars/Olympus",
    });
    expect(issues.some((issue) => issue.startsWith("DATABASE_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("PUBLIC_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("PORT"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("SIGNUP_ALLOWLIST"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("DEFAULT_TIMEZONE"))).toBe(true);
  });

  it("refuses non-trail databases outside production", () => {
    const issues = issuesOf({ ...minimal, DATABASE_URL: "postgres://me@localhost/velora" });
    expect(issues).toEqual([
      'DATABASE_URL: Refusing database "velora" outside production: its name must start with "trail"',
    ]);
    expect(issuesOf({ ...minimal, NODE_ENV: "development" })).toEqual([]);
    expect(
      issuesOf({ ...minimal, NODE_ENV: "production", DATABASE_URL: "postgres://db/other" }),
    ).toEqual([]);
  });
});

describe("parseTrustProxy", () => {
  it("understands booleans, hop counts and address lists", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("loopback,  10.0.0.0/8 ")).toBe("loopback, 10.0.0.0/8");
  });
});
