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
    expect(files.sort()).toEqual(["alignToRail.ts", "judgeRailPath.ts", "railNetwork.ts"]);
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

  it("only the pure processing modules are reached from the core", () => {
    const reached = new Set(
      files.flatMap((name) => importsOf(readFileSync(new URL(name, dir), "utf8"))),
    );
    for (const specifier of reached) {
      if (!specifier.startsWith("../") || specifier.startsWith("../../")) continue;
      const module = readFileSync(new URL(`../${specifier.slice(3)}.ts`, dir), "utf8");
      for (const inner of importsOf(module)) {
        expect(inner, `${specifier} imports ${inner}`).not.toMatch(
          /\/db\/|\/http\/|\/config\/|logging|drizzle|^node:|pg$/,
        );
      }
    }
  });
});
