import type { Server } from "node:http";
import {
  type DeviceWithCredentialsResponse,
  deviceWithCredentialsResponseSchema,
} from "@trail/contracts/device";
import request from "supertest";
import type { Agent } from "./authFlows";
import { testOrigin } from "./testEnvironment";

/** Registers a device for the agent's user and returns its credentials. */
export async function createDevice(
  agent: Agent,
  body: { name: string; deviceKey?: string },
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
