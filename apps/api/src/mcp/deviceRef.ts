import { safeText } from "./safeText";

/** A device as answers name it: its id, and its name made safe to hand to a model (`safeText`). */
export const deviceRef = (device: { id: string; name: string }) => ({
  id: device.id,
  name: safeText(device.name),
});

/** A name quoted for a summary line: JSON's quoting, so it reads as data, never as text of ours. */
export const quoted = (name: string): string => JSON.stringify(safeText(name));
