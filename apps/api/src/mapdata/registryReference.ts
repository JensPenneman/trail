/** Where the map data artefacts come from: a registry host and a repository on it. */
export interface RegistryReference {
  /** `ghcr.io`, or a host with its port: `registry.example.com:5000`. */
  host: string;
  /** `jenspenneman/trail-mapdata`. */
  repository: string;
}

/** The OCI distribution spec's repository name: path components of lowercase alphanumerics and separators. */
const component = "[a-z0-9]+(?:(?:\\.|_|__|-+)[a-z0-9]+)*";
const repositoryPattern = new RegExp(`^${component}(?:/${component})*$`);
const hostPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/**
 * Reads `MAP_DATA_REGISTRY`: a host and a repository, no scheme (Trail speaks
 * HTTPS only), no tag and no digest (the client asks for `<region>`). The host
 * must look like one — a dot, a port or `localhost` — as Docker decides
 * whether the first part of a name is a registry. Null when it is none of that.
 */
export function parseRegistryReference(value: string): RegistryReference | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const host = trimmed.slice(0, slash).toLowerCase();
  const repository = trimmed.slice(slash + 1);
  if (!hostPattern.test(host) || host.length > 253) return null;
  if (!host.includes(".") && !host.includes(":") && host !== "localhost") return null;
  const port = host.includes(":") ? Number(host.slice(host.indexOf(":") + 1)) : 443;
  if (!(port > 0 && port <= 65_535)) return null;
  if (repository.length > 255 || !repositoryPattern.test(repository)) return null;
  return { host, repository };
}

/** GitHub's container registry, the default (`ghcr.io/jenspenneman/trail-mapdata`). */
const ghcr = "ghcr.io";
/** Where GHCR redirects every blob download (a signed URL on GitHub's storage). */
const ghcrBlobHost = "pkg-containers.githubusercontent.com";

/**
 * The only hosts the client talks to for a registry (docs/design/self-hosted-maps.md
 * §4.3): the registry itself, for its API and its token service, and the host
 * its blob downloads may be redirected to — for GHCR the one host it uses,
 * for any other registry its own host only.
 */
export function registryHosts(reference: RegistryReference): {
  api: string;
  blobs: readonly string[];
} {
  return {
    api: reference.host,
    blobs: reference.host === ghcr ? [ghcr, ghcrBlobHost] : [reference.host],
  };
}
