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
      mcpAllowedOrigins: ["https://trail.example.com"],
      ingestUrl: "https://trail.example.com/api/overland",
      signupAllowlist: [],
      trustProxy: false,
      sessionTtlDays: 30,
      liveWindowMinutes: 15,
      staleAfterHours: 12,
      dataAccessRetentionDays: 365,
      alerts: null,
      defaultTimezone: "Europe/Brussels",
      mapStyles: {
        light: "https://tiles.openfreemap.org/styles/liberty",
        dark: "https://tiles.openfreemap.org/styles/dark",
        satellite: null,
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
        tokenPerMinute: 600,
        tokenFailedPer10Minutes: 30,
        publicSharePerMinute: 60,
      },
      processing: {
        enabled: true,
        overpassUrl: "https://overpass-api.de/api/interpreter",
        overpassDailyBytes: 300_000_000,
        osmTtlDays: 90,
        maxAccuracyM: 150,
        stopMinS: 180,
      },
    });
  });

  it("switches mapping off with an empty Overpass URL, and processing off altogether", () => {
    expect(
      loadConfig({ ...minimal, PROCESSING_OVERPASS_URL: "" }, defaults).processing,
    ).toMatchObject({
      enabled: true,
      overpassUrl: null,
    });
    expect(
      loadConfig({ ...minimal, PROCESSING_OVERPASS_URL: "  " }, defaults).processing.overpassUrl,
    ).toBeNull();
    const custom = loadConfig(
      {
        ...minimal,
        PROCESSING_ENABLED: "false",
        PROCESSING_OVERPASS_URL: "http://overpass.lan/api/interpreter",
        PROCESSING_OVERPASS_DAILY_MB: "50",
        PROCESSING_OSM_TTL_DAYS: "30",
        PROCESSING_MAX_ACCURACY_M: "100",
        PROCESSING_STOP_MIN_S: "300",
      },
      defaults,
    );
    expect(custom.processing).toEqual({
      enabled: false,
      overpassUrl: "http://overpass.lan/api/interpreter",
      overpassDailyBytes: 50_000_000,
      osmTtlDays: 30,
      maxAccuracyM: 100,
      stopMinS: 300,
    });
    expect(
      issuesOf({ ...minimal, PROCESSING_ENABLED: "yes", PROCESSING_OVERPASS_URL: "ftp://x" }),
    ).toEqual([
      "PROCESSING_ENABLED: Use true or false",
      expect.stringMatching(/^PROCESSING_OVERPASS_URL: /),
    ]);
  });

  it("treats empty variables as unset and parses lists", () => {
    const config = loadConfig(
      {
        ...minimal,
        NODE_ENV: "production",
        INGEST_BASE_URL: "",
        ADDITIONAL_ORIGINS: "http://localhost:8080, https://trail.example.com",
        MCP_ALLOWED_ORIGINS: "https://agent.example/, http://localhost:8080",
        SIGNUP_ALLOWLIST: " Jens@Example.com ,*@family.example ",
        MAP_STYLE_DARK: "https://maps.example.net/dark.json",
        ALERT_NTFY_URL: "https://ntfy.sh/trail-alerts",
        BUILD_TIME: "2026-09-30T19:41:07Z",
      },
      defaults,
    );
    expect(config.allowedOrigins).toEqual(["https://trail.example.com", "http://localhost:8080"]);
    expect(config.mcpAllowedOrigins).toEqual([
      "https://trail.example.com",
      "http://localhost:8080",
      "https://agent.example",
    ]);
    expect(config.ingestUrl).toBe("https://trail.example.com/api/overland");
    expect(config.signupAllowlist).toEqual(["jens@example.com", "*@family.example"]);
    expect(config.mapOrigins).toEqual([
      "https://tiles.openfreemap.org",
      "https://maps.example.net",
    ]);
    expect(config.alerts).toEqual({ url: "https://ntfy.sh/trail-alerts", token: null });
    expect(config.build.builtAt).toBe("2026-09-30T19:41:07.000Z");
  });

  it("offers satellite imagery as a style or as raster tiles, and lets the CSP reach it", () => {
    const style = loadConfig(
      {
        ...minimal,
        MAP_STYLE_SATELLITE: "https://api.maptiler.com/maps/satellite/style.json?key=k3y",
        // A style credits its own sources.
        MAP_STYLE_SATELLITE_ATTRIBUTION: "ignored",
      },
      defaults,
    );
    expect(style.mapStyles.satellite).toEqual({
      kind: "style",
      url: "https://api.maptiler.com/maps/satellite/style.json?key=k3y",
    });
    expect(style.mapOrigins).toEqual(["https://tiles.openfreemap.org", "https://api.maptiler.com"]);

    const tiles = loadConfig(
      {
        ...minimal,
        MAP_STYLE_SATELLITE: "https://imagery.example.net/tiles/{z}/{y}/{x}.jpg",
        MAP_STYLE_SATELLITE_ATTRIBUTION: "  Imagery © Example  ",
      },
      defaults,
    );
    expect(tiles.mapStyles.satellite).toEqual({
      kind: "raster",
      tiles: "https://imagery.example.net/tiles/{z}/{y}/{x}.jpg",
      attribution: "Imagery © Example",
    });
    expect(tiles.mapOrigins).toContain("https://imagery.example.net");
  });

  it("refuses tile templates it cannot fill in, or without the provider's credit", () => {
    expect(
      issuesOf({ ...minimal, MAP_STYLE_SATELLITE: "https://imagery.example.net/{z}/{x}/{y}" }),
    ).toEqual([
      "MAP_STYLE_SATELLITE_ATTRIBUTION: is required with a tile URL template: the credit the imagery provider asks for",
    ]);
    expect(
      issuesOf({
        ...minimal,
        MAP_STYLE_SATELLITE: "https://{s}.imagery.example.net/{z}/{x}/{y}.png",
        MAP_STYLE_SATELLITE_ATTRIBUTION: "Example",
      }),
    ).toEqual([
      "MAP_STYLE_SATELLITE: {s} is not filled in; a tile URL template takes {z}, {x} and {y} only",
    ]);
    expect(
      issuesOf({
        ...minimal,
        MAP_STYLE_SATELLITE: "https://imagery.example.net/{z}/{x}.png",
        MAP_STYLE_SATELLITE_ATTRIBUTION: "Example",
      }),
    ).toEqual(["MAP_STYLE_SATELLITE: a tile URL template needs {y}"]);
    expect(issuesOf({ ...minimal, MAP_STYLE_SATELLITE: "file:///tiles/{z}/{x}/{y}" })).toEqual([
      expect.stringMatching(/^MAP_STYLE_SATELLITE: /),
    ]);
    expect(issuesOf({ ...minimal, MAP_STYLE_SATELLITE: "" })).toEqual([]);
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
      MCP_ALLOWED_ORIGINS: "https://agent.example/app, chrome-extension://abc",
      DATA_ACCESS_RETENTION_DAYS: "0",
    });
    expect(issues.some((issue) => issue.startsWith("DATABASE_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("PUBLIC_URL"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("PORT"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("SIGNUP_ALLOWLIST"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("DEFAULT_TIMEZONE"))).toBe(true);
    expect(issues.filter((issue) => issue.startsWith("MCP_ALLOWED_ORIGINS"))).toHaveLength(2);
    expect(issues.some((issue) => issue.startsWith("DATA_ACCESS_RETENTION_DAYS"))).toBe(true);
    expect(
      loadConfig({ ...minimal, DATA_ACCESS_RETENTION_DAYS: "30" }, defaults)
        .dataAccessRetentionDays,
    ).toBe(30);
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
