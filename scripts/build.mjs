/* Production build of the web app and the API. NODE_ENV is forced to
 * production: a development value inherited from the shell makes Vite emit a
 * development build of React. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env, NODE_ENV: "production" };

for (const workspace of ["@trail/web", "@trail/api"]) {
  execFileSync("npm", ["run", "build", "-w", workspace], { cwd: root, env, stdio: "inherit" });
}
