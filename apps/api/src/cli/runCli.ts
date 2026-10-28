import { parseArgs } from "node:util";
import { ConfigError } from "../config/loadConfig";
import { ownEntry } from "../lib/ownEntry";
import { type CliContext, openCliContext } from "./cliContext";
import { inviteCommand } from "./commands/inviteCommand";
import { mapCommand } from "./commands/mapCommand";
import { passkeyLinkCommand } from "./commands/passkeyLinkCommand";
import { pruneCommand } from "./commands/pruneCommand";
import { recomputeCommand } from "./commands/recomputeCommand";
import { parseReprocessOptions, reprocessCommand } from "./commands/reprocessCommand";
import { usersCommand } from "./commands/usersCommand";
import { workerCommand } from "./commands/workerCommand";
import { usage } from "./usage";
import { UsageError } from "./usageError";

/** Parses a command's arguments (before any database work) and returns what to run. */
type Command = (args: string[]) => (ctx: CliContext) => Promise<void>;

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
  map: mapCommand,
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
    const run = command(args);
    ctx = await openCliContext(entryUrl);
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
