import { readFileSync } from "node:fs";
import { apiPaths } from "@trail/contracts/apiPaths";
import { ImmutableScript } from "./ImmutableScript";

/*
 * The bundle carries its own copy of zod, which probes for `new Function` to
 * build faster parsers. The page's CSP forbids eval and reports even the
 * failed probe as a violation, so zod's jitless mode — shared through
 * globalThis — is switched on before the bundle runs.
 */
const setupSource = `globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig ?? {}, { jitless: true });\n`;

/*
 * Everything that would reach another server stays off: the default fonts
 * (a CDN), telemetry, Scalar's chat agent and the MCP hints (the page's CSP
 * would block them anyway, and a blocked request is a console error), and
 * the button that opens Scalar's hosted client with this server's address.
 */
const configuration = {
  url: apiPaths.v1.openApi,
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  hideClientButton: true,
  showDeveloperTools: "never",
  persistAuth: false,
  documentDownloadType: "json",
  defaultOpenFirstTag: true,
};

const startSource = `Scalar.createApiReference("#reference", ${JSON.stringify(configuration)});\n`;

export interface ApiReferenceScripts {
  /** In page order: zod's setup, Scalar's standalone bundle, the start-up call. */
  ordered: readonly ImmutableScript[];
  byName: ReadonlyMap<string, ImmutableScript>;
}

const loaded = new Map<string, ApiReferenceScripts>();

/** The page's scripts, read and hashed once per process (the bundle is 4.6 MB). */
export function apiReferenceScripts(bundlePath: string): ApiReferenceScripts {
  let scripts = loaded.get(bundlePath);
  if (scripts === undefined) {
    const ordered = [
      new ImmutableScript("setup", setupSource),
      new ImmutableScript("scalar", readFileSync(bundlePath)),
      new ImmutableScript("start", startSource),
    ];
    scripts = { ordered, byName: new Map(ordered.map((script) => [script.fileName, script])) };
    loaded.set(bundlePath, scripts);
  }
  return scripts;
}
