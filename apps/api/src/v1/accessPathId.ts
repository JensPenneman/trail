import type { PathId } from "../dataAccess/inputResource";

/* What `{id}` names under each collection of the API. */
const collections: ReadonlyArray<readonly [RegExp, PathId]> = [
  [/^\/api\/v1\/devices\/\{id\}(\/|$)/, "device"],
  [/^\/api\/v1\/segments\/\{id\}(\/|$)/, "segment"],
  [/^\/api\/v1\/shares\/(incoming\/)?\{id\}(\/|$)/, "share"],
  [/^\/api\/v1\/share-links\/\{id\}(\/|$)/, "link"],
];

/**
 * What the `{id}` of a v1 path stands for in the data access log: a device,
 * a segment, a share or a link; null for a path without one (a unit test
 * holds every route with an `{id}` to a meaning).
 */
export const accessPathId = (path: string): PathId | null =>
  collections.find(([pattern]) => pattern.test(path))?.[1] ?? null;
