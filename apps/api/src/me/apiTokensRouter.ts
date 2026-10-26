import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ApiTokenListResponse,
  type ApiTokenResponse,
  type ApiTokenWithSecretResponse,
  createApiTokenRequestSchema,
  updateApiTokenRequestSchema,
} from "@trail/contracts/apiToken";
import express, { type Router } from "express";
import { createApiToken } from "../apiTokens/createApiToken";
import { listApiTokens } from "../apiTokens/listApiTokens";
import { revokeApiToken } from "../apiTokens/revokeApiToken";
import { rollApiToken } from "../apiTokens/rollApiToken";
import { toApiToken } from "../apiTokens/toApiToken";
import { updateApiToken } from "../apiTokens/updateApiToken";
import type { AppContext } from "../appContext";
import { requireSession } from "../auth/requestAuth";
import { parseBody } from "../http/parseInput";

/**
 * `/api/me/tokens*` — the user's API tokens (docs/architecture.md §8.4). Only
 * a person signed in with a passkey manages them: this is the private API, an
 * API token never reaches it, and `requireSession` would refuse one anyway.
 * Creating, rolling, changing and revoking are logged with the token's id,
 * never with its secret.
 */
export function apiTokensRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db, logger } = ctx;

  router.get(apiPaths.me.tokens, async (req, res) => {
    const { user } = requireSession(req);
    const now = Date.now();
    const body: ApiTokenListResponse = {
      tokens: (await listApiTokens(db, user.id)).map((row) => toApiToken(row, now)),
    };
    res.json(body);
  });

  router.post(apiPaths.me.tokens, async (req, res) => {
    const { user } = requireSession(req);
    const request = parseBody(createApiTokenRequestSchema, req);
    const { row, secret } = await createApiToken(db, user.id, request);
    logger.info({ tokenId: row.id, userId: user.id, scopes: row.scopes }, "API token created");
    const body: ApiTokenWithSecretResponse = { token: toApiToken(row), secret };
    res.status(201).json(body);
  });

  router.patch("/api/me/tokens/:id", async (req, res) => {
    const { user } = requireSession(req);
    const changes = parseBody(updateApiTokenRequestSchema, req);
    const row = await updateApiToken(db, user.id, req.params.id, changes);
    logger.info(
      { tokenId: row.id, userId: user.id, changed: Object.keys(changes) },
      "API token changed",
    );
    const body: ApiTokenResponse = { token: toApiToken(row) };
    res.json(body);
  });

  router.post("/api/me/tokens/:id/roll", async (req, res) => {
    const { user } = requireSession(req);
    const { row, secret } = await rollApiToken(db, user.id, req.params.id);
    logger.info({ tokenId: row.id, userId: user.id }, "API token rolled");
    const body: ApiTokenWithSecretResponse = { token: toApiToken(row), secret };
    res.json(body);
  });

  router.delete("/api/me/tokens/:id", async (req, res) => {
    const { user } = requireSession(req);
    if (await revokeApiToken(db, user.id, req.params.id)) {
      logger.info({ tokenId: req.params.id, userId: user.id }, "API token revoked");
    }
    res.status(204).end();
  });

  return router;
}
