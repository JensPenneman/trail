/**
 * The version of what the browser keeps on disk (docs/architecture.md §14),
 * and of its IndexedDB database: bumped by any change to the shape or the
 * meaning of a stored entry — another codec, another key, a body that means
 * something else — so that the store opens empty at the new one. A change the
 * contracts catch needs no bump: an entry that fails its schema is dropped
 * when it is read.
 */
export const cacheFormat = 1;
