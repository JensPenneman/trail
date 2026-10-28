import { describe, expect, it } from "vitest";
import { loadFleetPreflight, parseLoadFleetOptions } from "../../src/cli/commands/loadFleetCommand";
import { UsageError } from "../../src/cli/usageError";
import type { Config } from "../../src/config/config";
import { allocateProfiles } from "../../src/load/allocateProfiles";
import { LoadFleetRefused } from "../../src/load/createLoadFleet";
import { fleetMixes, fleetProfiles } from "../../src/load/fleetProfiles";
import { environmentRefusals, loadFleetRefusals } from "../../src/load/loadFleetRefusals";

const countOf = (profiles: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const profile of profiles) counts.set(profile, (counts.get(profile) ?? 0) + 1);
  return Object.fromEntries(counts);
};

describe("the load fleet's profiles", () => {
  it("are a thousand phones in every mix, each profile with its app", () => {
    for (const mix of Object.values(fleetMixes)) {
      expect(Object.values(mix).reduce((sum, count) => sum + count, 0)).toBe(1000);
      expect(Object.keys(mix).sort()).toEqual(fleetProfiles.map((profile) => profile.name).sort());
    }
    expect(new Set(fleetProfiles.map((profile) => profile.app))).toEqual(
      new Set(["overland", "owntracks", "traccar", "osmand", "gpslogger"]),
    );
  });

  it("allocates a thousand phones as the mix, a hundred as a tenth of it", () => {
    expect(countOf(allocateProfiles(1000, "default"))).toEqual(fleetMixes.default);
    expect(countOf(allocateProfiles(1000, "steered"))).toEqual(fleetMixes.steered);
    const hundred = countOf(allocateProfiles(100, "default"));
    for (const [name, count] of Object.entries(fleetMixes.default)) {
      expect(hundred[name]).toBe(count / 10);
    }
  });

  it("gives every profile a phone from ten phones on: ten are one of each", () => {
    expect(allocateProfiles(10, "default")).toEqual(fleetProfiles.map((profile) => profile.name));
    const twelve = allocateProfiles(12, "default");
    expect(twelve).toHaveLength(12);
    expect(new Set(twelve).size).toBe(fleetProfiles.length);
    const three = allocateProfiles(3, "default");
    expect(three).toHaveLength(3);
    expect(countOf(three)["overland-balanced"]).toBeGreaterThanOrEqual(1);
  });

  it("spreads each profile over the fleet, so its first people are a fair sample", () => {
    const fleet = allocateProfiles(100, "default");
    const firstTwenty = countOf(fleet.slice(0, 20));
    expect(firstTwenty["overland-balanced"]).toBe(5);
    expect(firstTwenty["traccar"]).toBe(4);
    expect(Object.keys(firstTwenty)).toHaveLength(fleetProfiles.length);
  });

  it("refuses a fleet of nobody", () => {
    expect(() => allocateProfiles(0, "default")).toThrow(RangeError);
    expect(() => allocateProfiles(1.5, "default")).toThrow(RangeError);
  });
});

describe("the load fleet's conditions", () => {
  const allowed = { loadTest: true, launchwayEnvironment: null, passkeys: 0, otherAccounts: 0 };

  it("hold on the Mac's capped stack and in a preview", () => {
    expect(loadFleetRefusals(allowed)).toEqual([]);
    expect(loadFleetRefusals({ ...allowed, launchwayEnvironment: "preview" })).toEqual([]);
  });

  it("refuse without LOAD_TEST, in production, with a passkey or a real account — each alone", () => {
    expect(loadFleetRefusals({ ...allowed, loadTest: false })).toEqual([
      expect.stringContaining("LOAD_TEST is not true"),
    ]);
    for (const production of ["production", "Production", " PRODUCTION "]) {
      expect(loadFleetRefusals({ ...allowed, launchwayEnvironment: production })).toEqual([
        expect.stringContaining("LAUNCHWAY_ENVIRONMENT is production"),
      ]);
    }
    expect(loadFleetRefusals({ ...allowed, passkeys: 1 })).toEqual([
      "the database holds a passkey (someone has signed in here)",
    ]);
    expect(loadFleetRefusals({ ...allowed, passkeys: 3 })).toEqual([
      "the database holds 3 passkeys (someone has signed in here)",
    ]);
    expect(loadFleetRefusals({ ...allowed, otherAccounts: 2 })).toEqual([
      "the database holds 2 accounts outside the load test's own",
    ]);
  });

  it("name every condition that fails at once", () => {
    expect(
      loadFleetRefusals({
        loadTest: false,
        launchwayEnvironment: "production",
        passkeys: 1,
        otherAccounts: 1,
      }),
    ).toHaveLength(4);
  });

  it("check the environment before the database is opened", () => {
    expect(environmentRefusals({ loadTest: true, launchwayEnvironment: null })).toEqual([]);
    const config = (loadTest: boolean, launchwayEnvironment: string | null) =>
      ({ loadTest, launchwayEnvironment }) as Config;
    expect(() => loadFleetPreflight(config(true, "preview"))).not.toThrow();
    expect(() => loadFleetPreflight(config(false, null))).toThrow(LoadFleetRefused);
    expect(() => loadFleetPreflight(config(true, "production"))).toThrow(
      /^refused: LAUNCHWAY_ENVIRONMENT is production/,
    );
  });
});

describe("trail load-fleet's options", () => {
  it("take a number of people, a mix, a share ratio and the probe", () => {
    expect(parseLoadFleetOptions({ people: "100" }, false)).toEqual({
      people: 100,
      mix: "default",
      shareRatio: 0.3,
      probe: false,
    });
    expect(
      parseLoadFleetOptions({ people: "10", mix: "steered", shares: "0", probe: true }, false),
    ).toEqual({ people: 10, mix: "steered", shareRatio: 0, probe: true });
  });

  it("refuse wrong values", () => {
    for (const people of [undefined, "0", "5001", "1.5", "ten"]) {
      expect(() => parseLoadFleetOptions(people === undefined ? {} : { people }, false)).toThrow(
        UsageError,
      );
    }
    expect(() => parseLoadFleetOptions({ people: "10", mix: "scenario-c" }, false)).toThrow(
      "--mix must be default or steered",
    );
    expect(() => parseLoadFleetOptions({ people: "10", shares: "1.5" }, false)).toThrow(UsageError);
  });

  it("never write the fleet's secrets into a terminal", () => {
    expect(() => parseLoadFleetOptions({ people: "10" }, true)).toThrow(/redirect it to a file/);
  });
});
