/* Runs the `checks` of a verification spec (deploy/verify.json) against a base
 * URL: `node scripts/verify.mjs <baseUrl> <spec>`. Exit 0 when every check
 * holds, 1 when one does not, 2 for a spec or arguments that are invalid.
 *
 * The spec is data, so what "healthy" means lives in the repository and
 * another runner (Launchway's release train) can apply the same semantics:
 *   - paths start with a single `/` and hold no backslash or control
 *     character, and resolve to the base URL's origin; methods are GET, HEAD
 *     or POST
 *   - `status` is the exact HTTP status; redirects are not followed
 *   - `contentType`, when given, must be the start of the Content-Type header
 *   - `json` maps dot paths ("processing.worker") to expected values; the
 *     value found and the expected one are compared as strings
 *   - `{version}` (package.json) and `{commit}` (the GIT_SHA variable, "dev"
 *     without it) are replaced in the expected values
 * `soak` is not run here: it is for the runner that watches a deployment.
 * Node only, no dependency: the image check runs it in a bare Node image. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const methods = ["GET", "HEAD", "POST"];
const requestTimeoutMs = 10_000;

/**
 * @typedef {object} Check
 * @property {string} [name]
 * @property {string} [method]
 * @property {string} path
 * @property {number} status
 * @property {string} [contentType]
 * @property {Record<string, string>} [json]
 */

/**
 * The most specific text of an error: fetch hides the socket's code in `cause`.
 * @param {unknown} error
 * @returns {string}
 */
const reason = (error) => {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  if (cause instanceof AggregateError) return String(cause.errors[0]?.code ?? cause.message);
  if (cause instanceof Error && "code" in cause) return String(cause.code);
  return error.message;
};

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`verify: ${message}`);
  process.exit(2);
}

const [baseArgument, specPath] = process.argv.slice(2);
if (baseArgument === undefined || specPath === undefined || process.argv.length > 4) {
  fail("usage: node scripts/verify.mjs <baseUrl> <spec>");
}
const base = URL.parse(baseArgument);
if (base === null || (base.protocol !== "http:" && base.protocol !== "https:")) {
  fail(`"${baseArgument}" is not an http(s) URL`);
}

/** @type {{ version?: unknown, checks?: Check[] }} */
let spec = {};
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  fail(`cannot read ${specPath}: ${reason(error)}`);
}
const checks = spec?.version === 1 && Array.isArray(spec.checks) ? spec.checks : [];
if (checks.length === 0) {
  fail(`${specPath}: expected {"version": 1, "checks": [...]} with at least one check`);
}

const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
/** @type {Record<string, string>} */
const values = { version: rootPackage.version, commit: process.env["GIT_SHA"] || "dev" };
/** @param {string} text */
const expand = (text) =>
  String(text).replace(/\{(version|commit)\}/g, (_, name) => values[name] ?? "");

/**
 * A path that starts with a single "/" and has no backslash or control character.
 * @param {string} path
 */
const isPlainPath = (path) =>
  /^\/(?!\/)/.test(path) &&
  [...path].every((char) => char !== "\\" && char.charCodeAt(0) > 0x1f && char !== "\x7f");

for (const [index, check] of checks.entries()) {
  const label = `checks[${index}]`;
  if (!methods.includes(check.method ?? "GET")) fail(`${label}: method must be GET, HEAD or POST`);
  if (typeof check.path !== "string" || !isPlainPath(check.path)) {
    fail(`${label}: path must start with a single "/" and hold no backslash or control character`);
  }
  // `new URL` reads "/\\host/x" as "//host/x"; whatever else it may read this
  // way, a request never leaves the base URL's origin.
  if (new URL(check.path, base).origin !== base.origin) {
    fail(`${label}: path leaves the origin of ${base.origin}`);
  }
  if (!Number.isInteger(check.status)) fail(`${label}: status must be an integer`);
}

/**
 * The value at a dot path of parsed JSON, or undefined.
 * @param {unknown} body
 * @param {string} path
 * @returns {unknown}
 */
const at = (body, path) =>
  path
    .split(".")
    .reduce(
      (node, key) =>
        node !== null && typeof node === "object" ? /** @type {never} */ (node)[key] : undefined,
      body,
    );

/**
 * Runs one check and returns the problems found (none: it holds).
 * @param {Check} check
 * @returns {Promise<string[]>}
 */
async function run(check) {
  const method = check.method ?? "GET";
  let response;
  try {
    response = await fetch(new URL(check.path, /** @type {URL} */ (base)), {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
  } catch (error) {
    return [`no answer: ${reason(error)}`];
  }
  /** @type {string[]} */
  const problems = [];
  if (response.status !== check.status) {
    problems.push(`status ${response.status}, expected ${check.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (check.contentType !== undefined && !contentType.startsWith(check.contentType)) {
    problems.push(`content-type "${contentType}", expected ${check.contentType}`);
  }
  if (check.json !== undefined) {
    let body;
    try {
      body = await response.json();
    } catch {
      problems.push("the body is not JSON");
    }
    if (body !== undefined) {
      for (const [path, expected] of Object.entries(check.json)) {
        const found = at(body, path);
        if (found === undefined || String(found) !== expand(expected)) {
          problems.push(`${path} is ${JSON.stringify(found)}, expected "${expand(expected)}"`);
        }
      }
    }
  }
  return problems;
}

let failed = 0;
for (const check of checks) {
  const name = check.name ?? `${check.method ?? "GET"} ${check.path}`;
  const problems = await run(check);
  if (problems.length === 0) {
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}: ${problems.join("; ")}`);
  }
}
console.log(`${checks.length - failed} of ${checks.length} checks hold`);
process.exit(failed === 0 ? 0 : 1);
