import type { DataAccessResource } from "@trail/contracts/dataAccess";
import type { Logger } from "pino";
import { errorCodes } from "../db/errorChain";
import { refusedDataCode } from "../db/refusedDataCode";
import { isUuid } from "../lib/isUuid";
import { safeText } from "../mcp/safeText";
import type { AccessActor, AccessRecord } from "./accessRecord";
import type { AccessStore } from "./accessStore";
import { canonicalResource } from "./canonicalResource";
import { actorIdentity, dedupeKey } from "./dedupeKey";
import type { AccessRow } from "./insertAccessRows";
import { visitorKey } from "./visitorKey";

export interface DataAccessOptions {
  /** Pending accesses are written this long after the first of them (2 s). */
  flushIntervalMs?: number;
  /** … or at once when this many distinct rows wait, and this many go in one statement (500). */
  batchSize?: number;
  /** While the database is away, at most this many rows wait; more are dropped (10 000). */
  maxPending?: number;
  /** An actor's distinct rows of one action in an hour before the rest folds into one (50). */
  foldAfter?: number;
  /** … and of all actions together, before every further one of each action folds (200). */
  rowsPerActor?: number;
  /** A link's distinct visitors (networks) in one hour, before the rest are counted together (50). */
  visitorsPerLink?: number;
  /** Distinct rows and visitors remembered for those limits per hour; past it, all new ones fold. */
  maxRegistered?: number;
  /** A row the database could not take is tried this often, then dropped (3). */
  maxAttempts?: number;
}

interface Pending {
  record: AccessRecord;
  bucketStart: Date;
  firstAt: Date;
  lastAt: Date;
  count: number;
  dedupeKey: string;
  attempts: number;
}

const hourMs = 3_600_000;
const sessionIdPattern = /^[0-9a-f]{64}$/;
/** Names people typed (tokens, display names, link labels): cleaned like the MCP server's. */
const labelLength = 80;

/** The ids an actor stands on are well-formed, or the row would fail the whole statement. */
function wellFormed(actor: AccessActor): boolean {
  switch (actor.kind) {
    case "owner":
      return sessionIdPattern.test(actor.sessionId);
    case "token":
      return isUuid(actor.tokenId);
    case "person":
      return isUuid(actor.userId) && (actor.shareId === null || isUuid(actor.shareId));
    case "link":
      return isUuid(actor.linkId);
  }
}

const cleaned = <A extends AccessActor>(actor: A): A => ({
  ...actor,
  label: safeText(actor.label, labelLength),
});

/** What a folded row keeps: the devices, and that it stands for more. */
const folded = (resource: DataAccessResource): DataAccessResource =>
  resource.deviceIds === undefined
    ? { folded: true }
    : { deviceIds: resource.deviceIds, folded: true };

const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);
const earlier = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

/** The row of a pending access; the visitor's key needs the server's key, `secret`. */
function toRow(pending: Pending, secret: Buffer | null): AccessRow {
  const { record } = pending;
  const { actor } = record;
  const visitor = actor.kind === "link" ? actor.visitor : null;
  return {
    ownerUserId: record.ownerUserId,
    bucketStart: pending.bucketStart,
    firstAt: pending.firstAt,
    lastAt: pending.lastAt,
    count: pending.count,
    actorKind: actor.kind,
    channel: record.channel,
    actorUserId: actor.kind === "person" ? actor.userId : null,
    actorSessionId: actor.kind === "owner" ? actor.sessionId : null,
    actorTokenId: actor.kind === "token" ? actor.tokenId : null,
    actorShareId: actor.kind === "person" ? actor.shareId : null,
    actorLinkId: actor.kind === "link" ? actor.linkId : null,
    actorLabel: actor.label,
    visitorKey:
      visitor === null || secret === null ? null : visitorKey(secret, record.ownerUserId, visitor),
    ipCoarse: visitor?.ipCoarse ?? null,
    uaFamily: visitor?.uaFamily ?? null,
    action: record.action,
    access: record.access,
    resource: record.resource,
    status: record.status,
    dedupeKey: pending.dedupeKey,
  };
}

/**
 * The data access log's writer (docs/architecture.md §8.7). `record` only
 * touches memory: accesses are counted per owner, UTC hour and access (the
 * row's unique key), and a write two seconds after the first — or as soon as
 * 500 distinct rows wait — puts them into the table with one upsert, so a
 * request never waits for the log and a burst of reads costs one row. Nothing
 * here fails a request: errors are logged. A failed write is tried again with
 * the next (a row at most three times); a row the database refuses is left out
 * on its own, never with the others; at most 10 000 rows wait in memory. An
 * actor's distinct rows of one action in an hour, and a link's distinct
 * visitors in an hour, are bounded: beyond 50 they fold into one row each, so
 * nobody can grow somebody else's log without bound. `flush` writes what is
 * pending (shutdown, tests).
 */
export class DataAccessRecorder {
  readonly #store: AccessStore;
  readonly #logger: Logger;
  readonly #options: Required<DataAccessOptions>;
  #pending = new Map<string, Pending>();
  #timer: NodeJS.Timeout | undefined;
  /** Writes run one after the other. */
  #writing: Promise<void> = Promise.resolve();
  #stopped = false;
  /** The hour the fold counts below are for: they start again with every hour. */
  #hour = 0;
  /** Distinct rows per actor and action, and visitors' networks per link, of the hour. */
  readonly #distinct = new Map<string, Set<string>>();
  /** Distinct rows per actor, all actions together, of the hour. */
  readonly #perActor = new Map<string, number>();
  /** Entries of the sets above, against `maxRegistered`. */
  #registered = 0;
  #dropped = 0;
  #droppedLoggedAt = 0;
  /** A write was asked for because a batch is full; the next one to start takes it. */
  #full = false;
  #secret: Promise<Buffer> | undefined;

  constructor(store: AccessStore, logger: Logger, options: DataAccessOptions = {}) {
    this.#store = store;
    this.#logger = logger;
    this.#options = {
      flushIntervalMs: options.flushIntervalMs ?? 2_000,
      batchSize: options.batchSize ?? 500,
      maxPending: options.maxPending ?? 10_000,
      foldAfter: options.foldAfter ?? 50,
      rowsPerActor: options.rowsPerActor ?? 200,
      visitorsPerLink: options.visitorsPerLink ?? 50,
      maxRegistered: options.maxRegistered ?? 50_000,
      maxAttempts: options.maxAttempts ?? 3,
    };
  }

  /** Counts one access; never throws, never waits. */
  record(access: AccessRecord): void {
    if (this.#stopped) return;
    try {
      this.#add(access);
    } catch (error) {
      this.#logger.error({ err: error, action: access.action }, "data access not recorded");
    }
  }

  /** Writes everything pending now, after a write that is running (tests, shutdown). */
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const write = this.#writing.then(() => this.#write());
    this.#writing = write;
    return write;
  }

  /** Takes no more accesses; `flush` first to write what is pending. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #add(access: AccessRecord): void {
    if (!isUuid(access.ownerUserId) || !wellFormed(access.actor)) {
      this.#logger.error(
        { action: access.action, actor: access.actor.kind },
        "data access with a malformed id not recorded",
      );
      return;
    }
    const at = access.at ?? new Date();
    const hour = Math.floor(at.getTime() / hourMs) * hourMs;
    if (hour > this.#hour) {
      this.#hour = hour;
      this.#distinct.clear();
      this.#perActor.clear();
      this.#registered = 0;
    }
    let resource = canonicalResource(access.resource);
    if (resource === null) {
      // A bug, not a request's fault: the access still counts, without its details.
      this.#logger.error({ action: access.action }, "data access resource refused by its schema");
      resource = {};
    }
    let record = { ...access, actor: cleaned(access.actor), resource } as AccessRecord;
    record = this.#foldVisitor(record, hour);
    let key = dedupeKey(record);
    const actor = `${record.ownerUserId}|${hour}|${JSON.stringify(actorIdentity(record.actor))}`;
    const rows = this.#seen(`${actor}|${record.action}`);
    if (!rows.has(key)) {
      const actorRows = this.#perActor.get(actor) ?? 0;
      if (
        rows.size >= this.#options.foldAfter ||
        actorRows >= this.#options.rowsPerActor ||
        this.#registered >= this.#options.maxRegistered
      ) {
        record = { ...record, resource: folded(record.resource) };
        key = dedupeKey(record);
      }
      if (this.#register(rows, key)) this.#perActor.set(actor, actorRows + 1);
    }
    this.#merge({
      record,
      bucketStart: new Date(hour),
      firstAt: at,
      lastAt: at,
      count: 1,
      dedupeKey: key,
      attempts: 0,
    });
    if (this.#pending.size < this.#options.batchSize) this.#schedule();
    else if (!this.#full) {
      this.#full = true;
      void this.flush();
    }
  }

  /**
   * Beyond `visitorsPerLink` visitors of a link in an hour, the next ones are
   * counted together. A visitor is a network here: another kind of browser
   * from a network that came already is no new visitor, so switching browsers
   * never buys more rows than the handful of kinds there are.
   */
  #foldVisitor(record: AccessRecord, hour: number): AccessRecord {
    if (record.channel !== "link" || record.actor.visitor === null) return record;
    const visitors = this.#seen(`${record.ownerUserId}|${hour}|${record.actor.linkId}|visitors`);
    const network = record.actor.visitor.ipCoarse ?? "";
    if (visitors.has(network)) return record;
    if (visitors.size < this.#options.visitorsPerLink && this.#register(visitors, network)) {
      return record;
    }
    return {
      ...record,
      actor: { ...record.actor, visitor: null },
      resource: folded(record.resource),
    };
  }

  /** Remembers `key` in `set` while the hour's registry has room; whether it did. */
  #register(set: Set<string>, key: string): boolean {
    if (set.has(key)) return true;
    if (this.#registered >= this.#options.maxRegistered) return false;
    set.add(key);
    this.#registered += 1;
    return true;
  }

  #seen(group: string): Set<string> {
    let set = this.#distinct.get(group);
    if (set === undefined) {
      set = new Set();
      this.#distinct.set(group, set);
    }
    return set;
  }

  #merge(entry: Pending): void {
    const key = `${entry.record.ownerUserId}|${entry.bucketStart.getTime()}|${entry.dedupeKey}`;
    const existing = this.#pending.get(key);
    if (existing !== undefined) {
      // The newest name and status: a token renamed within the hour shows its new name.
      if (entry.lastAt.getTime() >= existing.lastAt.getTime()) existing.record = entry.record;
      existing.count += entry.count;
      existing.firstAt = earlier(existing.firstAt, entry.firstAt);
      existing.lastAt = later(existing.lastAt, entry.lastAt);
      existing.attempts = Math.max(existing.attempts, entry.attempts);
      return;
    }
    if (this.#pending.size >= this.#options.maxPending) {
      this.#drop(entry.count);
      return;
    }
    this.#pending.set(key, entry);
  }

  /** Counts what is given up: logged at once, then at most once a minute. */
  #drop(count: number): void {
    this.#dropped += count;
    if (Date.now() - this.#droppedLoggedAt >= 60_000) this.#reportDropped();
  }

  #reportDropped(): void {
    if (this.#dropped === 0) return;
    this.#droppedLoggedAt = Date.now();
    this.#logger.error({ dropped: this.#dropped }, "data accesses dropped");
    this.#dropped = 0;
  }

  #schedule(): void {
    if (this.#timer !== undefined || this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#options.flushIntervalMs);
    this.#timer.unref();
  }

  async #write(): Promise<void> {
    const batch = [...this.#pending.values()];
    this.#pending = new Map();
    this.#full = false;
    for (let start = 0; start < batch.length; start += this.#options.batchSize) {
      const chunk = batch.slice(start, start + this.#options.batchSize);
      try {
        await this.#store.insert(await this.#rows(chunk));
      } catch (error) {
        await this.#recover(chunk, error);
      }
    }
    if (Date.now() - this.#droppedLoggedAt >= 60_000) this.#reportDropped();
    if (this.#pending.size > 0) this.#schedule();
  }

  async #rows(chunk: readonly Pending[]): Promise<AccessRow[]> {
    const needsKey = chunk.some(({ record }) => record.channel === "link");
    const secret = needsKey ? await this.#visitorSecret() : null;
    return chunk.map((pending) => toRow(pending, secret));
  }

  #visitorSecret(): Promise<Buffer> {
    if (this.#secret === undefined) {
      const loading = this.#store.visitorSecret();
      loading.catch(() => {
        if (this.#secret === loading) this.#secret = undefined;
      });
      this.#secret = loading;
    }
    return this.#secret;
  }

  /**
   * After a failed write: when the database refused the data, the rows go in
   * one by one and only the refused ones are left out (a bug must not cost
   * the others); anything else (the database away) is tried again later.
   */
  async #recover(chunk: readonly Pending[], error: unknown): Promise<void> {
    if (!refusesRows(error)) {
      this.#logger.error({ err: error, rows: chunk.length }, "data access log not written yet");
      this.#retry(chunk);
      return;
    }
    let refused = 0;
    for (const pending of chunk) {
      try {
        await this.#store.insert(await this.#rows([pending]));
      } catch (single) {
        if (refusesRows(single)) {
          refused += 1;
          this.#logger.error(
            { codes: errorCodes(single), action: pending.record.action },
            "data access row refused by the database",
          );
        } else {
          this.#retry([pending]);
        }
      }
    }
    if (refused > 0) this.#logger.error({ refused }, "data access rows left out");
  }

  #retry(chunk: readonly Pending[]): void {
    for (const pending of chunk) {
      if (pending.attempts + 1 >= this.#options.maxAttempts) this.#drop(pending.count);
      else this.#merge({ ...pending, attempts: pending.attempts + 1 });
    }
  }
}

/*
 * A statement whose data the database refused, a foreign key that failed (an
 * account deleted meanwhile) or two rows for one key (21000): the rows' fault,
 * so sending them again together would fail again.
 */
const refusesRows = (error: unknown): boolean =>
  refusedDataCode(error) !== null ||
  errorCodes(error).some((code) => code === "23503" || code === "21000");
