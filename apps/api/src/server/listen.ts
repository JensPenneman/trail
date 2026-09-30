import { createServer, type Server } from "node:http";
import type { Express } from "express";

/**
 * Starts the HTTP server. Keep-alive outlives the idle timeouts of the reverse
 * proxy / tunnel in front of it, so they never reuse a socket Node is closing
 * (which surfaces as random 502s).
 */
export function listen(app: Express, port: number, host: string): Promise<Server> {
  const server = createServer(app);
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
