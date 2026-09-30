import type { Server } from "node:http";
import {
  type FinishAuthResponse,
  finishAuthResponseSchema,
  passkeyOptionsResponseSchema,
  startAuthResponseSchema,
} from "@trail/contracts/auth";
import request from "supertest";
import { SoftwareAuthenticator } from "./softwareAuthenticator";
import { testOrigin } from "./testEnvironment";

export type Agent = ReturnType<typeof request.agent>;

export const agentFor = (app: Server): Agent => request.agent(app);

/** Full sign-up through the unified start: returns the finish response (cookie kept by the agent). */
export async function signUp(
  agent: Agent,
  authenticator: SoftwareAuthenticator,
  email: string,
  options: { origin?: string; inviteToken?: string } = {},
): Promise<FinishAuthResponse> {
  const origin = options.origin ?? testOrigin;
  const started = await agent
    .post("/api/auth/start")
    .set("Origin", origin)
    .send({
      email,
      ...(options.inviteToken === undefined ? {} : { inviteToken: options.inviteToken }),
    })
    .expect(200);
  const start = startAuthResponseSchema.parse(started.body);
  if (start.flow !== "register") throw new Error(`Expected a registration, got ${start.flow}`);
  const response = authenticator.createCredential(start.options, origin);
  const finished = await agent
    .post("/api/auth/finish")
    .set("Origin", origin)
    .send({ ceremonyId: start.ceremonyId, response })
    .expect(200);
  return finishAuthResponseSchema.parse(finished.body);
}

/** Email-first sign-in with a passkey of this origin's RP ID. */
export async function signIn(
  agent: Agent,
  authenticator: SoftwareAuthenticator,
  email: string,
  origin = testOrigin,
): Promise<FinishAuthResponse> {
  const started = await agent
    .post("/api/auth/start")
    .set("Origin", origin)
    .send({ email })
    .expect(200);
  const start = startAuthResponseSchema.parse(started.body);
  if (start.flow !== "authenticate") throw new Error(`Expected a sign-in, got ${start.flow}`);
  const response = authenticator.getAssertion(start.options, origin);
  const finished = await agent
    .post("/api/auth/finish")
    .set("Origin", origin)
    .send({ ceremonyId: start.ceremonyId, response })
    .expect(200);
  return finishAuthResponseSchema.parse(finished.body);
}

/** Usernameless sign-in ("Use a passkey" / conditional UI). */
export async function signInWithPasskey(
  agent: Agent,
  authenticator: SoftwareAuthenticator,
  origin = testOrigin,
): Promise<FinishAuthResponse> {
  const started = await agent.post("/api/auth/passkey").set("Origin", origin).expect(200);
  const start = passkeyOptionsResponseSchema.parse(started.body);
  const response = authenticator.getAssertion(start.options, origin);
  const finished = await agent
    .post("/api/auth/finish")
    .set("Origin", origin)
    .send({ ceremonyId: start.ceremonyId, response })
    .expect(200);
  return finishAuthResponseSchema.parse(finished.body);
}

/** Signs up a new account; returns the agent and its raw session cookie (`name=value`). */
export async function signUpWithCookie(
  app: Server,
  email: string,
): Promise<{ agent: Agent; cookie: string }> {
  const agent = agentFor(app);
  const started = await agent.post("/api/auth/start").set("Origin", testOrigin).send({ email });
  const start = startAuthResponseSchema.parse(started.body);
  if (start.flow !== "register") throw new Error(`Expected a registration, got ${start.flow}`);
  const finished = await agent
    .post("/api/auth/finish")
    .set("Origin", testOrigin)
    .send({
      ceremonyId: start.ceremonyId,
      response: new SoftwareAuthenticator().createCredential(start.options, testOrigin),
    })
    .expect(200);
  const cookie = String(finished.headers["set-cookie"]).split(";")[0] ?? "";
  return { agent, cookie };
}
