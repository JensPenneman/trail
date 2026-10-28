/* Production build of the web app and the API. NODE_ENV is forced to
 * production: a development value inherited from the shell makes Vite emit a
 * development build of React. The web app's service worker is written after
 * Vite has built it, from what it built (scripts/serviceWorker.mjs). */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeServiceWorker } from "./serviceWorker.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env, NODE_ENV: "production" };

execFileSync("npm", ["run", "build", "-w", "@trail/web"], { cwd: root, env, stdio: "inherit" });
const shell = await writeServiceWorker(fileURLToPath(new URL("../apps/web/dist", import.meta.url)));
console.log(`service worker: ${shell.files.length} files of the shell, version ${shell.version}`);
execFileSync("npm", ["run", "build", "-w", "@trail/api"], { cwd: root, env, stdio: "inherit" });
