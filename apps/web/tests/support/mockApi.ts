import { vi } from "vitest";

type Handler = (request: { url: URL; method: string; body: unknown }) => {
  status: number;
  body?: unknown;
};

/**
 * Replaces `fetch` with a table of API routes (`"GET /api/devices"`). Unknown
 * routes answer the contract's 404 so a missing fixture shows up as an error
 * state instead of hanging.
 */
export function mockApi(
  routes: Readonly<Record<string, Handler | { status: number; body?: unknown }>>,
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    const route = routes[`${method} ${url.pathname}`];
    const answer =
      route === undefined
        ? { status: 404, body: { error: { code: "not_found", message: "No fixture" } } }
        : typeof route === "function"
          ? route({ url, method, body })
          : route;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
