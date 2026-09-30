/** `trail --help`. */
export const usage = `Usage: trail <command> [options]

Commands:
  migrate                                  Apply pending database migrations (also done at boot)
  passkey-link <email> [--origin <url>]    One-time link (15 min) to add a passkey to an account;
                                           use it to recover an account that lost its passkeys
  invite [--email <email>] [--days <n>]    Invite link to create an account (default 7 days, max 30);
                                           with --email only that address can use it
  users                                    List all accounts
  recompute [--device <id>]                Rebuild heat cells and daily statistics (all devices or one)
  prune                                    Delete expired sessions, links, invites and old logs now
  help                                     Show this help

Configuration comes from the same environment as the server (DATABASE_URL, PUBLIC_URL, …).
Exit codes: 0 success, 1 failure, 2 wrong usage.

Examples:
  docker compose exec app trail invite --email alex@example.com
  docker compose exec app trail passkey-link jens@example.com --origin http://localhost:8080
`;
