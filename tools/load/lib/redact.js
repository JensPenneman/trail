/*
 * Nothing secret or personal in a log line, a report or a file the harness
 * keeps (docs/perf/README.md): device tokens, API tokens, share link secrets,
 * session secrets, the synthetic accounts' addresses and names, and positions.
 * `redact` cleans text that the harness passes on (k6's and Compose's output);
 * `leaksIn` finds what must never be in a report (report.mjs refuses to write
 * one that has any).
 */

const patterns = [
  { kind: "device token", pattern: /trl_[A-Za-z0-9_-]{20,}/g },
  { kind: "API token", pattern: /trlk_[A-Za-z0-9_-]{20,}/g },
  { kind: "share link secret", pattern: /trls_[A-Za-z0-9_-]{20,}/g },
  { kind: "session", pattern: /(trail_session=)[A-Za-z0-9_-]{43}/g },
  { kind: "address", pattern: /[A-Za-z0-9._%+-]+@load\.invalid/g },
  {
    kind: "position",
    pattern: /([?&](?:lat|lon|latitude|longitude|location)=)(?!\[redacted\])[^&\s"']+/gi,
  },
  {
    kind: "authorization",
    pattern: /(authorization["']?\s*[:=]\s*["']?)(?:bearer|basic)\s+[^\s"',]+/gi,
  },
];

/**
 * `text` with every secret, address and position replaced, `known` (the
 * fleet's own secrets and names) first.
 * @param {string} text
 * @param {readonly string[]} [known]
 */
export function redact(text, known = []) {
  let clean = text;
  for (const secret of known) {
    if (secret.length >= 6) clean = clean.split(secret).join("[redacted]");
  }
  for (const { pattern } of patterns) {
    clean = clean.replace(pattern, (match, prefix) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[redacted]` : "[redacted]",
    );
  }
  return clean;
}

/**
 * What of the secrets and personal data `text` holds: the kinds, never the values.
 * @param {string} text
 * @param {readonly string[]} [known]
 * @returns {string[]}
 */
export function leaksIn(text, known = []) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const secret of known) {
    if (secret.length >= 6 && text.includes(secret)) found.add("a secret or name of the fleet");
  }
  for (const { kind, pattern } of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.add(kind);
    pattern.lastIndex = 0;
  }
  return [...found];
}

/**
 * Everything of a fleet file that must stay out of logs and reports.
 * @param {{ people?: readonly { session?: string, devices?: readonly { token?: string, deviceKey?: string }[] }[] }} fleet
 * @returns {string[]}
 */
export function secretsOf(fleet) {
  /** @type {string[]} */
  const secrets = [];
  for (const person of fleet.people ?? []) {
    if (person.session !== undefined) secrets.push(person.session);
    for (const device of person.devices ?? []) {
      if (device.token !== undefined) secrets.push(device.token);
      if (device.deviceKey !== undefined) secrets.push(device.deviceKey);
    }
  }
  return secrets;
}
