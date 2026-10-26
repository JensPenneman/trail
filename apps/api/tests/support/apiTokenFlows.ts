import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ApiTokenWithSecretResponse,
  apiTokenWithSecretResponseSchema,
  type CreateApiTokenRequest,
} from "@trail/contracts/apiToken";
import type { Agent } from "./authFlows";
import { testOrigin } from "./testEnvironment";

/** `Authorization` header value for an API token secret. */
export const bearer = (secret: string): string => `Bearer ${secret}`;

/** Creates an API token as the agent's signed-in user would in Settings; returns it with its secret. */
export async function createApiToken(
  agent: Agent,
  body: CreateApiTokenRequest,
): Promise<ApiTokenWithSecretResponse> {
  const response = await agent
    .post(apiPaths.me.tokens)
    .set("Origin", testOrigin)
    .send(body)
    .expect(201);
  return apiTokenWithSecretResponseSchema.parse(response.body);
}
