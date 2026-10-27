import type { Server } from "node:http";
import {
  type DeviceWithCredentialsResponse,
  deviceWithCredentialsResponseSchema,
} from "@trail/contracts/device";
import type { DeviceApp } from "@trail/contracts/deviceApp";
import request from "supertest";
import type { Agent } from "./authFlows";
import { testOrigin } from "./testEnvironment";

/** Registers a device for the agent's user (Overland's unless `source` says otherwise) and returns its credentials. */
export async function createDevice(
  agent: Agent,
  body: { name: string; deviceKey?: string; source?: DeviceApp },
): Promise<DeviceWithCredentialsResponse> {
  const response = await agent
    .post("/api/devices")
    .set("Origin", testOrigin)
    .send(body)
    .expect(201);
  return deviceWithCredentialsResponseSchema.parse(response.body);
}

/** Posts an Overland upload with a bearer token, like the app does. */
export function postOverland(app: Server, token: string, payload: unknown) {
  return request(app)
    .post("/api/overland")
    .set("Authorization", `Bearer ${token}`)
    .set("User-Agent", "Overland/2025.9 CFNetwork Darwin")
    .send(payload as object);
}

/** HTTP Basic credentials as OwnTracks sends them: any user name, the token as password. */
export const basicAuth = (username: string, password: string): string =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

/**
 * Posts one OwnTracks message as the Android app does, over HTTPS as Trail's
 * trusted proxy reports it (the tests trust loopback): Basic authentication
 * needs it.
 */
export function postOwnTracks(app: Server, token: string, message: unknown) {
  return request(app)
    .post("/api/owntracks")
    .set("Authorization", basicAuth("pixel-8-k3f9", token))
    .set("X-Forwarded-Proto", "https")
    .set("X-Limit-U", "pixel-8-k3f9")
    .set("X-Limit-D", "pixel-8-k3f9")
    .set("User-Agent", "Owntracks-Android/gms/420509000")
    .set("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(message));
}
