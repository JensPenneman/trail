import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The rail core is carried to another framework later (the plan's carry-over to
 * keelwerk): its files import only other pure processing modules, the contracts
 * and pure helpers, never the database, the HTTP layer, the configuration, the
 * logger, an ORM or a Node API.
 */
const dir = new URL("../../src/processing/rail/", import.meta.url);
const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "");

const allowed = (specifier: string): boolean =>
  // Siblings and the pure processing modules next door.
  /^\.\.\/(?!\.\.)[A-Za-z]+$/.test(specifier) ||
  /^\.\/[A-Za-z]+$/.test(specifier) ||
  specifier === "../../tracks/haversine" ||
  specifier === "@trail/contracts/transport";

describe("the rail core", () => {
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));

  it("has the files of the plan", () => {
    expect(files.sort()).toEqual([
      "alignToRail.ts",
      "judgeRailPath.ts",
      "railNetwork.ts",
      "trainPlausible.ts",
    ]);
  });

  it.each(files)(
    "%s imports nothing from the database, the framework or the HTTP layer",
    (name) => {
      const specifiers = importsOf(readFileSync(new URL(name, dir), "utf8"));
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(allowed(specifier), `${name} imports ${specifier}`).toBe(true);
        expect(specifier).not.toMatch(
          /db|http|config\/|logging|drizzle|pg|^node:|fastify|hono|express/i,
        );
      }
    },
  );

  it("reaches nothing impure through any chain of imports, type imports included", () => {
    const root = new URL("../../src/", import.meta.url);
    const start = [
      ...files.map((name) => new URL(`processing/rail/${name}`, root)),
      new URL("processing/matchLegs.ts", root),
      new URL("processing/regionCoverage.ts", root),
    ];
    const forbidden =
      /(^|\/)(db|http|config|logging|dataAccess|events)(\/|$)|drizzle|^node:|^pg$|fastify|hono|express|pino/i;
    const seen = new Set<string>();
    const chains: string[] = [];
    const visit = (file: URL, via: string) => {
      if (seen.has(file.href)) return;
      seen.add(file.href);
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        if (forbidden.test(specifier)) chains.push(`${via} -> ${specifier}`);
        // Packages (the contracts) end the walk; a relative import is followed.
        if (!specifier.startsWith(".")) continue;
        const next = new URL(`${specifier}.ts`, file);
        visit(next, `${via} -> ${specifier}`);
      }
    };
    for (const file of start) visit(file, file.pathname.split("/src/")[1] ?? file.pathname);
    expect(chains).toEqual([]);
    // The walk reached the modules it should have: the check is not vacuous.
    expect([...seen].some((href) => href.endsWith("/processing/wayIndex.ts"))).toBe(true);
    expect([...seen].some((href) => href.endsWith("/processing/pipelineTypes.ts"))).toBe(true);
  });
});
