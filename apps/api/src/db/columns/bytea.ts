import { customType } from "drizzle-orm/pg-core";

/** Raw bytes (`bytea`); node-postgres returns them as a Buffer. Drizzle has no built-in bytea column. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
