import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/ApiError";
import { queryKeys } from "../src/api/queryKeys";
import { createQueryClient } from "../src/app/createQueryClient";
import { user } from "./support/fixtures";

describe("createQueryClient", () => {
  it("marks the session as signed out when any request answers 401", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.session, user);
    await client
      .fetchQuery({
        queryKey: queryKeys.devices,
        queryFn: () =>
          Promise.reject(
            new ApiError({ status: 401, code: "unauthorized", message: "Session ended" }),
          ),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.session)).toBeNull();
  });

  it("retries server trouble twice but never a client error", async () => {
    const client = createQueryClient();
    const attempts = async (error: ApiError) => {
      let count = 0;
      await client
        .fetchQuery({
          queryKey: ["probe", error.status],
          queryFn: () => {
            count += 1;
            return Promise.reject(error);
          },
          retryDelay: 0,
        })
        .catch(() => undefined);
      return count;
    };
    expect(
      await attempts(new ApiError({ status: 503, code: "unavailable", message: "Down" })),
    ).toBe(3);
    expect(await attempts(new ApiError({ status: 404, code: "not_found", message: "Gone" }))).toBe(
      1,
    );
  });
});
