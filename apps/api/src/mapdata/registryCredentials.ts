import { inspect } from "node:util";

/** Printable ASCII without spaces: what a user name and a token consist of. */
const printable = /^[\x21-\x7e]+$/;

/**
 * Credentials for a private registry (`MAP_DATA_REGISTRY_TOKEN`,
 * `<user>:<token>`): sent as HTTP Basic to the registry's token service only,
 * never to a blob host. The token is kept in a private field and the object
 * prints as `[redacted]`, so a logged configuration never carries it.
 */
export class RegistryCredentials {
  readonly username: string;
  readonly #password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.#password = password;
  }

  /** The `Authorization` header for the token service. */
  basicAuthorization(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.#password}`, "utf8").toString("base64")}`;
  }

  toJSON(): string {
    return "[redacted]";
  }

  [inspect.custom](): string {
    return "RegistryCredentials [redacted]";
  }
}

/** Reads `<user>:<token>`; null when it is not that shape. */
export function parseRegistryCredentials(value: string): RegistryCredentials | null {
  const colon = value.indexOf(":");
  if (colon <= 0 || value.length > 4096) return null;
  const username = value.slice(0, colon);
  const password = value.slice(colon + 1);
  if (!printable.test(username) || !printable.test(password)) return null;
  return new RegistryCredentials(username, password);
}
