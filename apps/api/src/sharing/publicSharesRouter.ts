import type { PublicShareResponse } from "@trail/contracts/shareLink";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { loadPublicShare } from "./loadPublicShare";

/**
 * `GET /api/public/shares/:secret` — what a public link shows, without an
 * account (docs/architecture.md §8.4). Mounted before the dashboard's `/api`
 * chain behind its own per-address limit: no session is read and no cookie
 * set. The answer is `no-store`, like every `/api` answer.
 */
export function publicSharesRouter(ctx: AppContext): Router {
  const router = express.Router();
  router.get("/:secret", async (req, res) => {
    const body: PublicShareResponse = await loadPublicShare(ctx, req.params.secret);
    res.json(body);
  });
  return router;
}
