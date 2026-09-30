import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreatePasskeyLinkResponse,
  createPasskeyLinkRequestSchema,
} from "@trail/contracts/passkeyLink";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { normaliseOrigin } from "../config/normaliseOrigin";
import { HttpError } from "../http/httpError";
import { parseBody } from "../http/parseInput";
import { createPasskeyLink } from "./createPasskeyLink";

/** `POST /api/me/passkey-links` — a 15-minute link to add a passkey on another device or origin. */
export function passkeyLinksRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.post(apiPaths.me.passkeyLinks, async (req, res) => {
    const { user } = requireAuth(req);
    const request = parseBody(createPasskeyLinkRequestSchema, req);
    const origin =
      request.origin === undefined ? ctx.config.publicUrl : normaliseOrigin(request.origin);
    if (origin === null || !ctx.config.allowedOrigins.includes(origin)) {
      throw new HttpError(
        400,
        "validation_failed",
        "This address is not one of the server's addresses.",
        {
          origin: [`Use one of: ${ctx.config.allowedOrigins.join(", ")}`],
        },
      );
    }
    const link = await createPasskeyLink(ctx.db, { userId: user.id, origin, createdBy: "user" });
    const body: CreatePasskeyLinkResponse = {
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
    };
    res.status(201).json(body);
  });

  return router;
}
