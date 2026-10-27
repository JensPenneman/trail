import type { Database } from "../db/database";
import { loadServerSecret } from "../db/loadServerSecret";
import { type AccessRow, insertAccessRows } from "./insertAccessRows";
import { visitorSecretName } from "./visitorKey";

/** Where the data access log's rows go: the table, or a stand-in in unit tests. */
export interface AccessStore {
  /** Writes rows in one statement, adding to the hours' rows that exist. */
  insert(rows: readonly AccessRow[]): Promise<void>;
  /** The server's key for the visitor keys, made on first use and kept. */
  visitorSecret(): Promise<Buffer>;
}

/** The `data_access_events` table and the `data-access-visitor` key of `server_secrets`. */
export const tableAccessStore = (db: Database): AccessStore => ({
  insert: (rows) => insertAccessRows(db, rows),
  visitorSecret: () => loadServerSecret(db, visitorSecretName),
});
