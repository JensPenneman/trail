import { parseArgs } from "node:util";
import type { Pool } from "pg";
import type { Config } from "../config/config";
import { ConfigError } from "../config/loadConfig";
import { ownEntry } from "../lib/ownEntry";
import { type CliContext, openCliContext } from "./cliContext";
import { inviteCommand } from "./commands/inviteCommand";
import {
  loadFleetCommand,
  loadFleetDatabaseCheck,
  loadFleetPreflight,
  parseLoadFleetOptions,
} from "./commands/loadFleetCommand";
import { passkeyLinkCommand } from "./commands/passkeyLinkCommand";
import { pruneCommand } from "./commands/pruneCommand";
import { recomputeCommand } from "./commands/recomputeCommand";
import { parseReprocessOptions, reprocessCommand } from "./commands/reprocessCommand";
import { usersCommand } from "./commands/usersCommand";
import { workerCommand } from "./commands/workerCommand";
import { usage } from "./usage";
import { UsageError } from "./usageError";

/**
 * What a command runs, and what it checks first: the configuration before the
 * database is opened, the database before it is migrated.
 */
interface CommandRun {
  preflight?: (config: Config) => void;
  beforeMigrations?: (pool: Pool) => Promise<void>;
  run: (ctx: CliContext) => Promise<void>;
}

/** Parses a command's arguments (before any database work) and returns what to run. */
type Command = (args: string[]) => ((ctx: CliContext) => Promise<void>) | CommandRun;

const noOptions = (args: string[]) => parseArgs({ args, options: {} });

/* Arguments are validated strictly: an unknown flag is an error, not ignored. */
const commands: Readonly<Record<string, Command>> = {
  migrate: (args) => {
    noOptions(args);
    return async () => {
      console.log("Database schema is up to date.");
    };
  },
  "passkey-link": (args) => {
    const { positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: { origin: { type: "string" } },
    });
    if (positionals.length !== 1)
      throw new UsageError("passkey-link takes exactly one email address");
    return (ctx) => passkeyLinkCommand(ctx, positionals[0], values.origin);
  },
  invite: (args) => {
    const { values } = parseArgs({
      args,
      options: { email: { type: "string" }, days: { type: "string" } },
    });
    return (ctx) => inviteCommand(ctx, values.email, values.days);
  },
  users: (args) => {
    noOptions(args);
    return usersCommand;
  },
  recompute: (args) => {
    const { values } = parseArgs({ args, options: { device: { type: "string" } } });
    return (ctx) => recomputeCommand(ctx, values.device);
  },
  reprocess: (args) => {
    const { values } = parseArgs({
      args,
      options: {
        device: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        "from-level": { type: "string" },
      },
    });
    const options = {
      device: values.device,
      from: values.from,
      to: values.to,
      fromLevel: values["from-level"],
    };
    parseReprocessOptions(options);
    return (ctx) => reprocessCommand(ctx, options);
  },
  prune: (args) => {
    noOptions(args);
    return pruneCommand;
  },
  "load-fleet": (args) => {
    const { values } = parseArgs({
      args,
      options: {
        people: { type: "string" },
        mix: { type: "string" },
        shares: { type: "string" },
        probe: { type: "boolean" },
      },
    });
    const options = parseLoadFleetOptions(values, process.stdout.isTTY === true);
    return {
      preflight: loadFleetPreflight,
      beforeMigrations: loadFleetDatabaseCheck,
      run: (ctx) => loadFleetCommand(ctx, options),
    };
  },
};

const isArgumentError = (error: unknown): error is Error =>
  error instanceof UsageError ||
  (error instanceof TypeError &&
    "code" in error &&
    String(error.code).startsWith("ERR_PARSE_ARGS"));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs `trail <command>`; resolves to the process exit code (0 ok, 1 failure, 2 usage). */
export async function runCli(argv: readonly string[], entryUrl: string): Promise<number> {
  const [name, ...args] = argv;
  if (name === "help" || name === "--help" || name === "-h") {
    console.log(usage);
    return 0;
  }
  if (name === undefined) {
    console.error(usage);
    return 2;
  }
  // A service, not a command: it opens its own pool and logs as the server does.
  if (name === "worker") {
    try {
      noOptions(args);
    } catch (error) {
      if (!isArgumentError(error)) throw error;
      console.error(`trail worker: ${error.message}\n\n${usage}`);
      return 2;
    }
    return workerCommand(entryUrl);
  }
  const command = ownEntry(commands, name);
  if (command === undefined) {
    console.error(`trail: unknown command "${name}"\n\n${usage}`);
    return 2;
  }

  let ctx: CliContext | undefined;
  try {
    const parsed = command(args);
    const { run, ...checks }: CommandRun = typeof parsed === "function" ? { run: parsed } : parsed;
    ctx = await openCliContext(entryUrl, checks);
    await run(ctx);
    return 0;
  } catch (error) {
    if (isArgumentError(error)) {
      console.error(`trail ${name}: ${error.message}\n\n${usage}`);
      return 2;
    }
    if (error instanceof ConfigError) {
      console.error(`trail: ${error.message}`);
      return 1;
    }
    console.error(`trail ${name}: ${messageOf(error)}`);
    return 1;
  } finally {
    await ctx?.close();
  }
}
