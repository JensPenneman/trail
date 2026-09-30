/* Starts the development stack: Postgres (compose.yaml), the API (tsx watch)
 * and the web app (Vite). Variables from .env override the shell's own — a
 * DATABASE_URL exported for another project must never reach this one. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (!existsSync(envPath)) {
  console.error("dev: .env is missing — copy .env.example to .env first");
  process.exit(1);
}

const env = {
  ...process.env,
  ...parseEnv(readFileSync(envPath, "utf8")),
  NODE_ENV: "development",
  FORCE_COLOR: "1",
};

execFileSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit" });

const services = [
  { name: "api", color: "\u001b[36m", workspace: "@trail/api" },
  { name: "web", color: "\u001b[35m", workspace: "@trail/web" },
];

const children = services.map(({ name, color, workspace }) => {
  const child = spawn("npm", ["run", "dev", "-w", workspace], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `${color}${name}\u001b[0m │ `;
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
