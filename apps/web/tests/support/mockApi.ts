import { vi } from "vitest";

/** One answer of a route: a status and a body, optionally with the ETag the answer carries. */
interface Answer {
  status: number;
  body?: unknown;
  /**
   * The answer's ETag. A request whose `If-None-Match` names it gets `304 Not
   * Modified` without a body, as the server answers a copy that is current.
   */
  etag?: string;
}

interface Request {
  url: URL;
  method: string;
  body: unknown;
  headers: Readonly<Record<string, string>>;
}

/** A route's answer, or a promise of one: a request that a test lets wait. */
type Handler = (request: Request) => Answer | Promise<Answer>;

/**
 * Replaces `fetch` with a table of API routes (`"GET /api/devices"`). Unknown
 * routes answer the contract's 404 so a missing fixture shows up as an error
 * state instead of hanging. An answer with an `etag` answers `304` to a
 * request that sends it back.
 */
export function mockApi(routes: Readonly<Record<string, Handler | Answer>>) {
  const calls: {
    method: string;
    path: string;
    /** The whole address, query string included. */
    url?: string;
    body: unknown;
    headers?: Readonly<Record<string, string>>;
    /** The status it was answered with, once it was. */
    status?: number;
  }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: (typeof calls)[number] = {
      method,
      path: url.pathname,
      url: url.toString(),
      body,
      headers,
    };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`];
    const answer =
      route === undefined
        ? { status: 404, body: { error: { code: "not_found", message: "No fixture" } } }
        : typeof route === "function"
          ? await route({ url, method, body, headers })
          : route;
    const responseHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (answer.etag !== undefined) responseHeaders["ETag"] = answer.etag;
    const notModified =
      answer.etag !== undefined &&
      answer.status === 200 &&
      headers["if-none-match"] === answer.etag;
    call.status = notModified ? 304 : answer.status;
    if (notModified) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: responseHeaders,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
