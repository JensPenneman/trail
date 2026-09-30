/**
 * After a deploy the old page may ask for code chunks that no longer exist;
 * browsers word that failure differently, but it always fixes itself on reload.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    error.message,
  );
}
