import { defineConfig } from "drizzle-kit";

/* `npm run db:generate -w @trail/api` diffs the schema against drizzle/meta and
 * writes a new SQL migration; the API applies pending migrations at boot. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  strict: true,
});
