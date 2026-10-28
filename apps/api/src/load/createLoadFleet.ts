import { randomBytes } from "node:crypto";
import type { DeviceApp } from "@trail/contracts/deviceApp";
import { count, notLike } from "drizzle-orm";
import { lockSignups } from "../auth/signupLock";
import type { Database, Transaction } from "../db/database";
import { devices } from "../db/schema/devices";
import { passkeys } from "../db/schema/passkeys";
import { sessions } from "../db/schema/sessions";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { generateDeviceToken } from "../devices/generateDeviceToken";
import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";
import { allocateProfiles } from "./allocateProfiles";
import { type FleetMix, fleetProfiles } from "./fleetProfiles";
import { loadAccountDomain, loadFleetRefusals } from "./loadFleetRefusals";

/** What the harness reads (tools/load): the fleet's ids and secrets. */
const loadFleetFormat = "trail-load-fleet/1";

/** The SSE probe's own phone: one point per request, outside the mix. */
const probeProfile = "probe";

/** Rows per statement, well inside Postgres' 65 535 parameters. */
const rowsPerInsert = 500;

interface LoadFleetDevice {
  id: string;
  profile: string;
  app: DeviceApp;
  deviceKey: string;
  /** The device token (`trl_…`), as a phone would hold it. */
  token: string;
}

interface LoadFleetPerson {
  index: number;
  userId: string;
  /** The session cookie's value: the dashboard scenario and the SSE probe sign in with it. */
  session: string;
  /** The SSE probe's account, outside the mix. */
  probe: boolean;
  devices: LoadFleetDevice[];
}

export interface LoadFleet {
  format: typeof loadFleetFormat;
  createdAt: string;
  mix: FleetMix;
  people: LoadFleetPerson[];
  /** Shares between the fleet's people (precise, today's history), for the People page and its live events. */
  shares: number;
}

export interface LoadFleetInput {
  people: number;
  mix: FleetMix;
  /** The share of people who share their location with the next two (the design's 30 %). */
  shareRatio: number;
  probe: boolean;
  sessionTtlDays: number;
  timezone: string;
  now: Date;
}

/** The environment's half of the conditions: `LOAD_TEST` and `LAUNCHWAY_ENVIRONMENT`. */
export interface LoadFleetEnvironment {
  loadTest: boolean;
  launchwayEnvironment: string | null;
}

/** Thrown when a condition of the load test does not hold (docs/perf/README.md). */
export class LoadFleetRefused extends Error {
  readonly refusals: readonly string[];

  constructor(refusals: readonly string[]) {
    super(`refused: ${refusals.join("; ")}`);
    this.name = "LoadFleetRefused";
    this.refusals = refusals;
  }
}

const appOf = (profile: string): DeviceApp =>
  fleetProfiles.find((entry) => entry.name === profile)?.app ?? "owntracks";

function chunks<T>(items: readonly T[]): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < items.length; start += rowsPerInsert) {
    parts.push(items.slice(start, start + rowsPerInsert));
  }
  return parts;
}

/** Person `index` shares with the next two people, for `shareRatio` of the people. */
function sharesOf(index: number, people: number, shareRatio: number): number[] {
  if (people < 3 || shareRatio <= 0) return [];
  // An even spread: person i shares when the running total of the ratio crosses a whole number.
  if (Math.floor((index + 1) * shareRatio) === Math.floor(index * shareRatio)) return [];
  return [(index + 1) % people, (index + 2) % people];
}

async function refuseUnlessLoadDatabase(tx: Transaction, input: LoadFleetEnvironment) {
  const [keys] = await tx.select({ total: count() }).from(passkeys);
  const [others] = await tx
    .select({ total: count() })
    .from(users)
    .where(notLike(users.email, `%@${loadAccountDomain}`));
  const refusals = loadFleetRefusals({
    ...input,
    passkeys: keys?.total ?? 0,
    otherAccounts: others?.total ?? 0,
  });
  if (refusals.length > 0) throw new LoadFleetRefused(refusals);
}

/**
 * Creates the synthetic people of a load test (`trail load-fleet`): an account
 * per person at the `.invalid` domain, one phone each with its own device
 * token, a session per person, and shares among them — rows the server's own
 * paths would have made, written directly. Refused, before any row is written
 * and under the sign-up lock (so that nobody signs up in between), unless every
 * condition of `loadFleetRefusals` holds. Everything happens in one
 * transaction: a refusal or a failure leaves nothing behind.
 */
export async function createLoadFleet(
  db: Database,
  environment: LoadFleetEnvironment,
  input: LoadFleetInput,
): Promise<LoadFleet> {
  const run = randomBytes(3).toString("hex");
  const plan: { index: number; profile: string; probe: boolean }[] = allocateProfiles(
    input.people,
    input.mix,
  ).map((profile, index) => ({ index, profile, probe: false }));
  if (input.probe) plan.push({ index: plan.length, profile: probeProfile, probe: true });
  const expiresAt = new Date(input.now.getTime() + input.sessionTtlDays * 86_400_000);

  return db.transaction(async (tx) => {
    await lockSignups(tx);
    await refuseUnlessLoadDatabase(tx, environment);

    const people: LoadFleetPerson[] = [];
    for (const part of chunks(plan)) {
      const emailOf = (index: number) => `load-${run}-${index + 1}@${loadAccountDomain}`;
      const created = await tx
        .insert(users)
        .values(
          part.map((entry) => ({
            email: emailOf(entry.index),
            displayName: `Load ${entry.index + 1}`,
            webauthnUserId: randomBytes(32),
            timezone: input.timezone,
          })),
        )
        .returning({ id: users.id, email: users.email });
      const userIds = new Map(created.map((row) => [row.email, row.id]));
      const rows = part.map((entry) => {
        const userId = userIds.get(emailOf(entry.index));
        if (userId === undefined) throw new Error("Storing a load-test account returned no row");
        return {
          ...entry,
          userId,
          app: entry.probe ? ("owntracks" as const) : appOf(entry.profile),
          deviceKey: `load-${run}-${entry.index + 1}`,
          deviceToken: generateDeviceToken(),
          session: randomToken(),
        };
      });
      const deviceIds = await tx
        .insert(devices)
        .values(
          rows.map((row) => ({
            userId: row.userId,
            name: row.profile,
            source: row.app,
            deviceKey: row.deviceKey,
            tokenHash: row.deviceToken.hash,
            tokenHint: row.deviceToken.hint,
          })),
        )
        .returning({ id: devices.id, userId: devices.userId });
      const deviceOf = new Map(deviceIds.map((row) => [row.userId, row.id]));
      await tx.insert(sessions).values(
        rows.map((row) => ({
          id: hashToken(row.session),
          userId: row.userId,
          expiresAt,
          userAgent: "Trail load test",
          ip: null,
        })),
      );
      for (const row of rows) {
        const id = deviceOf.get(row.userId);
        if (id === undefined) throw new Error("Storing a load-test device returned no row");
        people.push({
          index: row.index,
          userId: row.userId,
          session: row.session,
          probe: row.probe,
          devices: [
            {
              id,
              profile: row.profile,
              app: row.app,
              deviceKey: row.deviceKey,
              token: row.deviceToken.token,
            },
          ],
        });
      }
    }

    const fleet = people.filter((person) => !person.probe);
    const shareRows = fleet.flatMap((owner) =>
      sharesOf(owner.index, fleet.length, input.shareRatio).map((recipientIndex) => {
        const recipient = fleet[recipientIndex];
        if (recipient === undefined) throw new Error("A share's recipient is missing");
        return {
          ownerUserId: owner.userId,
          recipientEmail: `load-${run}-${recipient.index + 1}@${loadAccountDomain}`,
          recipientUserId: recipient.userId,
          precision: "precise" as const,
          historyDays: 1,
        };
      }),
    );
    for (const part of chunks(shareRows)) await tx.insert(shares).values(part);

    return {
      format: loadFleetFormat,
      createdAt: input.now.toISOString(),
      mix: input.mix,
      people,
      shares: shareRows.length,
    };
  });
}
