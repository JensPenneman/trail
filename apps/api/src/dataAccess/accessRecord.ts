import type { DataAccessKind, DataAccessResource } from "@trail/contracts/dataAccess";

/** The owner, signed in: their own browser session (`sessions.id`). */
export interface OwnerActor {
  kind: "owner";
  sessionId: string;
  /** The session's browser, "Safari on iPhone". */
  label: string;
}

/** One of the owner's API tokens, called directly or through the MCP server. */
export interface TokenActor {
  kind: "token";
  tokenId: string;
  /** The token's name. */
  label: string;
}

/**
 * Someone the owner shares with. Only the person and the share are kept:
 * their sessions, tokens, browsers and addresses are their own business.
 */
export interface PersonActor {
  kind: "person";
  userId: string;
  shareId: string | null;
  /** Their display name. */
  label: string;
}

/**
 * A visitor of a public link, as far as the owner may learn: the network
 * (IPv4 /24, IPv6 /48) and the kind of browser — never the address itself.
 */
interface LinkActor {
  kind: "link";
  linkId: string;
  /** The link's label. */
  label: string;
  /** Null for the visitors counted together once a link had too many in an hour. */
  visitor: { ipCoarse: string | null; uaFamily: string } | null;
}

export type AccessActor = OwnerActor | TokenActor | PersonActor | LinkActor;

/** What every recorded access says besides who and through which channel. */
interface AccessFacts {
  /** Whose data it was. */
  ownerUserId: string;
  /** A v1 operationId, `dashboard.<route>`, `mcp.<tool>`, `link.view` or `live.position`. */
  action: string;
  access: DataAccessKind;
  /** Which data: devices, a range, a level … never a coordinate. */
  resource: DataAccessResource;
  /** The answer's status. */
  status: number;
  /** When it happened; now by default. */
  at?: Date;
}

/**
 * One access to someone's data, as the code that served it reports it
 * (docs/architecture.md §8.8). The channel goes with the kind of actor, as
 * the table's check has it: the owner's browser is `web`, their tokens are
 * `api` or `mcp`, people they share with `people` or `live`, link visitors
 * `link`.
 */
export type AccessRecord = AccessFacts &
  (
    | { channel: "web"; actor: OwnerActor }
    | { channel: "api" | "mcp"; actor: TokenActor }
    | { channel: "people" | "live"; actor: PersonActor }
    | { channel: "link"; actor: LinkActor }
  );

/**
 * Whose data an answer holds when it is not the caller's own — a person who
 * shares with the caller — and which: one access in that person's log each.
 */
export interface AccessOwner {
  ownerUserId: string;
  /** The share the caller looked through. */
  shareId: string | null;
  resource: DataAccessResource;
}
