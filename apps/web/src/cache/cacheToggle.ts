/** This browser's choice (Settings › Preferences › On this device), not the account's. */
const toggleKey = "trail.cache";

/**
 * Whether this browser keeps a copy of the owner's data: on unless turned off
 * here. Read before anything is restored; a browser that refuses
 * localStorage keeps the default.
 */
export function readCacheToggle(): boolean {
  try {
    return window.localStorage.getItem(toggleKey) !== "off";
  } catch {
    return true;
  }
}

export function writeCacheToggle(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(toggleKey);
    else window.localStorage.setItem(toggleKey, "off");
  } catch {
    // the choice holds for this page load only
  }
}
