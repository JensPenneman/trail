import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type AddPasskeyOptionsResponse,
  type AddPasskeyResponse,
  addPasskeyRequestSchema,
  type PasskeyListResponse,
  renamePasskeyRequestSchema,
} from "@trail/contracts/passkey";
import { and, asc, count, eq, sql } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { consumeCeremony, createCeremony } from "../auth/ceremonies";
import { currentRpId } from "../auth/currentRpId";
import { finishAddPasskey } from "../auth/finishAddPasskey";
import { registrationOptions } from "../auth/registrationOptions";
import { requireAuth } from "../auth/requestAuth";
import { requireCeremonyOrigin } from "../auth/requireCeremonyOrigin";
import { toPasskey } from "../auth/toPasskey";
import { passkeys } from "../db/schema/passkeys";
import { users } from "../db/schema/users";
import { HttpError, notFound } from "../http/httpError";
import { parseBody } from "../http/parseInput";

/** `/api/me/passkeys*` — list, add, rename and delete the signed-in user's passkeys. */
export function passkeysRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  router.get(apiPaths.me.passkeys, async (req, res) => {
    const { user } = requireAuth(req);
    const rows = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, user.id))
      .orderBy(asc(passkeys.createdAt));
    const rpId = currentRpId(req, ctx.config.allowedOrigins);
    const body: PasskeyListResponse = { passkeys: rows.map((row) => toPasskey(row, rpId)) };
    res.json(body);
  });

  router.post(apiPaths.me.passkeyOptions, async (req, res) => {
    const { user } = requireAuth(req);
    const { origin, rpId } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
    const existing = await db
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(and(eq(passkeys.userId, user.id), eq(passkeys.rpId, rpId)));
    const options = await registrationOptions({
      rpId,
      email: user.email,
      displayName: user.displayName,
      webauthnUserId: new Uint8Array(user.webauthnUserId),
      existing,
    });
    const ceremonyId = await createCeremony(db, {
      kind: "add_passkey",
      challenge: options.challenge,
      rpId,
      origin,
      userId: user.id,
    });
    const body: AddPasskeyOptionsResponse = { ceremonyId, options };
    res.json(body);
  });

  router.post(apiPaths.me.passkeys, async (req, res) => {
    const { user } = requireAuth(req);
    const { origin, rpId } = requireCeremonyOrigin(req, ctx.config.allowedOrigins);
    const request = parseBody(addPasskeyRequestSchema, req);
    const ceremony = await consumeCeremony(db, request.ceremonyId);
    if (ceremony.origin !== origin) {
      throw new HttpError(403, "origin_not_allowed", "Finish on the page where you started.");
    }
    const row = await finishAddPasskey(ctx, ceremony, {
      userId: user.id,
      response: request.response,
      name: request.name,
    });
    const body: AddPasskeyResponse = { passkey: toPasskey(row, rpId) };
    res.status(201).json(body);
  });

  router.patch("/api/me/passkeys/:id", async (req, res) => {
    const { user } = requireAuth(req);
    const { name } = parseBody(renamePasskeyRequestSchema, req);
    const [row] = await db
      .update(passkeys)
      .set({ name })
      .where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, user.id)))
      .returning();
    if (row === undefined) throw notFound("No such passkey.");
    const body: AddPasskeyResponse = {
      passkey: toPasskey(row, currentRpId(req, ctx.config.allowedOrigins)),
    };
    res.json(body);
  });

  router.delete("/api/me/passkeys/:id", async (req, res) => {
    const { user } = requireAuth(req);
    const passkeyId = req.params.id;
    await db.transaction(async (tx) => {
      // Serialise deletions per account so two parallel requests cannot remove the last two.
      await tx.execute(sql`SELECT 1 FROM ${users} WHERE ${users.id} = ${user.id} FOR UPDATE`);
      const [owned] = await tx
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id)));
      if (owned === undefined) throw notFound("No such passkey.");
      const [total] = await tx
        .select({ value: count() })
        .from(passkeys)
        .where(eq(passkeys.userId, user.id));
      if ((total?.value ?? 0) <= 1) {
        throw new HttpError(
          409,
          "last_passkey",
          "This is your only passkey. Add another one before deleting it.",
        );
      }
      await tx.delete(passkeys).where(eq(passkeys.id, passkeyId));
    });
    res.status(204).end();
  });

  return router;
}
