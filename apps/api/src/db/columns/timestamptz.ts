import { timestamp } from "drizzle-orm/pg-core";

/** Every instant is stored as `timestamptz` and mapped to a JS Date. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
