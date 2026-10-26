import { safeText } from "./safeText";

/* What CoreMotion reported, as the phone sent it: short words such as
 * `walking`, but text from a device all the same. */
export const presentMotion = (motion: readonly string[]): string[] =>
  motion.slice(0, 8).map((value) => safeText(value, 40));
