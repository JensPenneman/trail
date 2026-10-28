/* Starts the development stack: Postgres (compose.yaml), the API and the
 * processing worker (tsx watch) and the web app (Vite). The API runs in role
 * `api` and the worker in role `worker`, as the containers of
 * deploy/compose.yaml do, whatever .env says about PROCESSING_ROLE.
 * Variables from .env override the shell's own — a DATABASE_URL exported for
 * another project must never reach this one. In the development container
 * (.devcontainer) its own Compose project holds the database and the
 * environment, so neither compose.yaml nor .env is used, and Vite listens on
 * every interface for `scripts/devc.sh up --web`. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const inDevContainer = process.env["TRAIL_DEVCONTAINER"] !== undefined;

if (!inDevContainer && !existsSync(envPath)) {
  console.error("dev: .env is missing — copy .env.example to .env first");
  process.exit(1);
}

const env = {
  ...process.env,
  ...(inDevContainer ? {} : parseEnv(readFileSync(envPath, "utf8"))),
  NODE_ENV: "development",
  FORCE_COLOR: "1",
};

if (!inDevContainer) {
  execFileSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit" });
}

const services = [
  {
    name: "api",
    color: "\u001b[36m",
    workspace: "@trail/api",
    script: "dev",
    args: [],
    // Queues the uploads' processing; the worker works it out.
    role: "api",
  },
  {
    name: "worker",
    color: "\u001b[33m",
    workspace: "@trail/api",
    script: "dev:worker",
    args: [],
    role: "worker",
  },
  {
    name: "web",
    color: "\u001b[35m",
    workspace: "@trail/web",
    script: "dev",
    // A published port reaches the container on its own address, not on loopback.
    args: inDevContainer ? ["--", "--host", "0.0.0.0"] : [],
    role: undefined,
  },
];
const width = Math.max(...services.map(({ name }) => name.length));

const children = services.map(({ name, color, workspace, script, args, role }) => {
  const child = spawn("npm", ["run", script, "-w", workspace, ...args], {
    cwd: root,
    env: role === undefined ? env : { ...env, PROCESSING_ROLE: role },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `${color}${name.padEnd(width)}\u001b[0m │ `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("exit", (code) => {
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
/** @param {number} code */
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
