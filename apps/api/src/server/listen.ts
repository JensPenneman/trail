import { createServer, type RequestListener, type Server } from "node:http";

/**
 * Starts the HTTP server with a first listener (the answers while starting)
 * and returns it with `serve`, which hands every later request to the app.
 * Keep-alive outlives the idle timeouts of the reverse proxy / tunnel in
 * front of it, so they never reuse a socket Node is closing (which surfaces
 * as random 502s).
 */
export function listen(
  first: RequestListener,
  port: number,
  host: string,
): Promise<{ server: Server; serve(app: RequestListener): void }> {
  let current = first;
  const server = createServer((req, res) => {
    current(req, res);
  });
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({
        server,
        serve(app) {
          current = app;
        },
      });
    });
  });
}
