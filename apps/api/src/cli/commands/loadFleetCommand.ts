import type { Pool } from "pg";
import type { Config } from "../../config/config";
import { createLoadFleet, LoadFleetRefused } from "../../load/createLoadFleet";
import { existingAccounts } from "../../load/existingAccounts";
import { type FleetMix, isFleetMix } from "../../load/fleetProfiles";
import { databaseRefusals, environmentRefusals } from "../../load/loadFleetRefusals";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

/** The design's ceiling for one node is about 5 000 phones (docs/design/capacity.md §5.6). */
const maxPeople = 5_000;

export interface LoadFleetOptions {
  people: number;
  mix: FleetMix;
  shareRatio: number;
  probe: boolean;
}

/** Checks the options before anything is opened. */
export function parseLoadFleetOptions(
  values: { people?: string; mix?: string; shares?: string; probe?: boolean },
  stdoutIsTerminal: boolean,
): LoadFleetOptions {
  // The fleet's secrets are the output: they belong in a file, never in a terminal's scrollback.
  if (stdoutIsTerminal) {
    throw new UsageError(
      "load-fleet writes the fleet's secrets to standard output: redirect it to a file (docker compose exec -T app trail load-fleet … > fleet.json)",
    );
  }
  const people = Number(values.people);
  if (
    values.people === undefined ||
    !Number.isInteger(people) ||
    people < 1 ||
    people > maxPeople
  ) {
    throw new UsageError(`--people must be a whole number from 1 to ${maxPeople}`);
  }
  const mix = values.mix ?? "default";
  if (!isFleetMix(mix)) throw new UsageError("--mix must be default or steered");
  const shareRatio = values.shares === undefined ? 0.3 : Number(values.shares);
  if (!Number.isFinite(shareRatio) || shareRatio < 0 || shareRatio > 1) {
    throw new UsageError("--shares must be a share of the people from 0 to 1");
  }
  return { people, mix, shareRatio, probe: values.probe === true };
}

/** Refuses before the database is opened (and migrated) when the environment forbids a load test. */
export function loadFleetPreflight(config: Config): void {
  const refusals = environmentRefusals(config);
  if (refusals.length > 0) throw new LoadFleetRefused(refusals);
}

/**
 * Refuses before the CLI migrates the database when it holds someone's account
 * already: a wrong DATABASE_URL is never migrated by a load test.
 */
export async function loadFleetDatabaseCheck(pool: Pool): Promise<void> {
  const refusals = databaseRefusals(await existingAccounts(pool));
  if (refusals.length > 0) throw new LoadFleetRefused(refusals);
}

/**
 * `trail load-fleet --people <n>` — the synthetic people, phones and sessions
 * of a load test (docs/perf/README.md). Their ids and secrets go to stdout as
 * one JSON document for the harness; stderr gets counts only, never a token, a
 * session, a name or an address.
 */
export async function loadFleetCommand(ctx: CliContext, options: LoadFleetOptions): Promise<void> {
  const fleet = await createLoadFleet(ctx.db, ctx.config, {
    ...options,
    sessionTtlDays: ctx.config.sessionTtlDays,
    timezone: ctx.config.defaultTimezone,
    now: new Date(),
  });
  console.log(JSON.stringify(fleet));
  const phones = fleet.people.reduce((sum, person) => sum + person.devices.length, 0);
  console.error(
    `load-fleet: ${fleet.people.length} people, ${phones} phones, ${fleet.people.length} sessions and ${fleet.shares} shares created`,
  );
}
