import type { Executor } from "../db/database";
import { loadServerSecret } from "../db/loadServerSecret";

/**
 * The key of the sharing grids, created the first time it is needed and kept
 * in the database: a new key would move every grid, and a recipient who saw
 * both could intersect old and new cells.
 */
export const loadGridKey = (db: Executor): Promise<Buffer> => loadServerSecret(db, "share-grid");
