/** Outcome of normalising one Overland record: the value, or why it goes to the dead letter. */
export type Normalised<T> = { ok: true; value: T } | { ok: false; reason: string };

export const rejected = <T>(reason: string): Normalised<T> => ({ ok: false, reason });
