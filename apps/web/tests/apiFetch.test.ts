import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "../src/api/ApiError";
import { apiFetch } from "../src/api/apiFetch";
import { apiUrl } from "../src/api/apiUrl";
import { isSessionLost } from "../src/api/isSessionLost";
import { noContentSchema } from "../src/api/noContentSchema";

const schema = z.object({ ok: z.literal(true) });

function respond(status: number, body: string | null, contentType = "application/json") {
  const fetchMock = vi.fn(
    async () => new Response(body, { status, headers: { "Content-Type": contentType } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("apiFetch", () => {
  it("parses a successful answer with the contract schema", async () => {
    respond(200, JSON.stringify({ ok: true }));
    await expect(apiFetch("/api/x", schema)).resolves.toEqual({ ok: true });
  });

  it("sends JSON with the session cookie and defaults to POST when there is a body", async () => {
    const fetchMock = respond(200, JSON.stringify({ ok: true }));
    await apiFetch("/api/x", schema, { body: { name: "Phone" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/x");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe('{"name":"Phone"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("accepts an empty 204 answer as undefined", async () => {
    respond(204, null);
    await expect(
      apiFetch("/api/x", noContentSchema, { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("maps the error body to a typed ApiError", async () => {
    respond(
      422,
      JSON.stringify({
        error: {
          code: "validation_failed",
          message: "Check the name.",
          fields: { name: ["Too long"] },
        },
      }),
    );
    const error = await failure(apiFetch("/api/x", schema));
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("Check the name.");
    expect(error.fields).toEqual({ name: ["Too long"] });
  });

  it("gives a proxy's non-JSON error a sensible code and message", async () => {
    respond(502, "<html>Bad gateway</html>", "text/html");
    const error = await failure(apiFetch("/api/x", schema));
    expect(error.code).toBe("unavailable");
    expect(error.message).toMatch(/not reachable/);
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = await failure(apiFetch("/api/x", schema));
    expect(error.status).toBe(0);
    expect(error.code).toBe("network");
  });

  it("flags an answer that does not match the contract", async () => {
    respond(200, JSON.stringify({ ok: "yes" }));
    const error = await failure(apiFetch("/api/x", schema));
    expect(error.code).toBe("invalid_response");
  });

  it("lets aborts through untouched", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(abort)),
    );
    await expect(apiFetch("/api/x", schema)).rejects.toBe(abort);
  });
});

describe("apiUrl", () => {
  it("drops empty values and joins lists", () => {
    expect(
      apiUrl("/api/tracks", {
        from: "2026-09-29T22:00:00.000Z",
        deviceIds: ["a", "b"],
        maxPoints: undefined,
        empty: [],
        cursor: null,
      }),
    ).toBe("/api/tracks?from=2026-09-29T22%3A00%3A00.000Z&deviceIds=a%2Cb");
    expect(apiUrl("/api/devices")).toBe("/api/devices");
  });
});

describe("isSessionLost", () => {
  it("is true for a 401 except an unknown passkey", () => {
    expect(isSessionLost(new ApiError({ status: 401, code: "unauthorized", message: "x" }))).toBe(
      true,
    );
    expect(
      isSessionLost(new ApiError({ status: 401, code: "unknown_credential", message: "x" })),
    ).toBe(false);
    expect(isSessionLost(new ApiError({ status: 403, code: "forbidden", message: "x" }))).toBe(
      false,
    );
    expect(isSessionLost(new Error("x"))).toBe(false);
  });
});
