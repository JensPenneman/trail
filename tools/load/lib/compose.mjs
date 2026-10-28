/*
 * The capped stack as the harness drives it: `docker compose` of the
 * production file with tools/load/compose.load.yaml over it, as project
 * `trail-load`, and commands in its containers. Output that a command prints
 * is redacted before it is shown (lib/redact.js).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.js";

export const projectName = "trail-load";
export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const productionFile = fileURLToPath(new URL("../../../deploy/compose.yaml", import.meta.url));
const loadFile = fileURLToPath(new URL("../compose.load.yaml", import.meta.url));

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} Finished
 * @typedef {{
 *   input?: string | NodeJS.ReadableStream,
 *   stdoutTo?: import("node:fs").WriteStream,
 *   show?: boolean,
 *   known?: readonly string[],
 *   env?: NodeJS.ProcessEnv,
 *   allowFailure?: boolean,
 * }} RunOptions
 */

/**
 * Runs a command; its output is collected (or written to `stdoutTo`) and, with
 * `show`, printed redacted as it comes.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {Promise<Finished>}
 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (options.stdoutTo !== undefined) options.stdoutTo.write(chunk);
      else stdout += chunk.toString();
      if (options.show === true && options.stdoutTo === undefined) {
        process.stdout.write(redact(chunk.toString(), options.known));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (options.show === true) process.stderr.write(redact(chunk.toString(), options.known));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const finished = { code: code ?? 1, stdout, stderr };
      if (finished.code !== 0 && options.allowFailure !== true) {
        const detail = redact(stderr.trim().split("\n").slice(-5).join("\n"), options.known);
        reject(
          new Error(
            `${command} ${args.slice(0, 6).join(" ")} … exited ${finished.code}: ${detail}`,
          ),
        );
        return;
      }
      resolve(finished);
    });
    if (typeof options.input === "string") child.stdin.end(options.input);
    else if (options.input !== undefined) options.input.pipe(child.stdin);
    else child.stdin.end();
  });
}

export class LoadStack {
  /**
   * @param {{ envFile: string, env: NodeJS.ProcessEnv }} settings
   */
  constructor(settings) {
    this.envFile = settings.envFile;
    this.env = settings.env;
  }

  /** @param {readonly string[]} args */
  composeArgs(args) {
    return [
      "compose",
      "--project-name",
      projectName,
      "--env-file",
      this.envFile,
      "--file",
      productionFile,
      "--file",
      loadFile,
      ...args,
    ];
  }

  /**
   * @param {readonly string[]} args
   * @param {RunOptions} [options]
   */
  compose(args, options = {}) {
    return run("docker", this.composeArgs(args), { env: this.env, ...options });
  }

  /**
   * A command in a running service, without a terminal.
   * @param {string} service
   * @param {readonly string[]} command
   * @param {RunOptions} [options]
   */
  exec(service, command, options = {}) {
    return this.compose(["exec", "-T", service, ...command], options);
  }

  /**
   * One SQL statement in the database, its rows as tab-separated text.
   * @param {string} statement
   * @param {RunOptions} [options]
   */
  async psql(statement, options = {}) {
    const result = await this.exec(
      "db",
      ["psql", "-U", "trail", "-d", "trail", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement],
      options,
    );
    return result.stdout.trim();
  }

  /**
   * One SQL statement that returns one JSON value.
   * @param {string} statement
   */
  async json(statement) {
    const text = await this.psql(statement);
    return JSON.parse(text === "" ? "null" : text);
  }

  /** The project's containers: id, service and name. */
  async containers() {
    const result = await run(
      "docker",
      [
        "ps",
        "--filter",
        `label=com.docker.compose.project=${projectName}`,
        "--format",
        '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.Names}}',
      ],
      { env: this.env },
    );
    return result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [id = "", service = "", name = ""] = line.split("\t");
        return { id, service, name };
      });
  }
}

/** Trail stacks running on this machine other than this one: the Mac allows two at a time. */
export async function otherTrailStacks() {
  const result = await run("docker", ["ps", "--format", "{{.Names}}"]);
  return result.stdout
    .split("\n")
    .filter((name) => /^trail-.*-dev-1$/.test(name) && name !== `${projectName}-dev-1`);
}
