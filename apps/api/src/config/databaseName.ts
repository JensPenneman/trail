/** Database name from a `postgres://…/<name>` connection string, or null when it has none. */
export function databaseName(connectionString: string): string | null {
  const url = URL.parse(connectionString);
  if (url === null) return null;
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return name.length > 0 ? name : null;
}
