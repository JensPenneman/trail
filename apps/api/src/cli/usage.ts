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
  reprocess [--device <id>] [--from <iso> --to <iso>] [--from-level averaged|mapped|inferred]
                                           Work out the averaged, mapped and inferred levels again
                                           (all history by default; mapped: map matching on;
                                           inferred: stops, moves and modes only)
  prune                                    Delete expired sessions, links, invites and old logs now
  worker                                   Run the processing worker in the foreground until SIGTERM
                                           (the worker service's command; logs on stdout)
  map import <dir>                         Import a region's map data from a build's directory
                                           (manifest.json, ways.opl.gz, pois.geojsonseq.gz,
                                           region.poly) and swap it in for the region's old build
  map refresh [<region>]                   Pull the newest map data of the regions (MAP_DATA_REGIONS)
                                           or of one, when the registry has another build, and
                                           import it (what the worker does every MAP_DATA_REFRESH_DAYS)
  map status                               List the map regions' builds on the volume, with their
                                           digests, those in the map tables, and the Overpass cache
  help                                     Show this help

Configuration comes from the same environment as the server (DATABASE_URL, PUBLIC_URL, …).
Exit codes: 0 success, 1 failure, 2 wrong usage.

Examples:
  docker compose exec app trail invite --email alex@example.com
  docker compose exec app trail passkey-link jens@example.com --origin http://localhost:8080
`;
