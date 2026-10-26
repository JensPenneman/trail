import { type PublicShareResponse, shareSecretHeader } from "@trail/contracts/shareLink";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { loadPublicShare } from "./loadPublicShare";

/**
 * `GET /api/public/share` — what a public link shows, without an account
 * (docs/architecture.md §8.5). The page sends the link's secret, which it
 * keeps in the address's fragment, in the `X-Share-Secret` header: no URL
 * ever carries it, so no access log or proxy records it. Mounted before the
 * dashboard's `/api` chain behind its own per-address limit: no session is
 * read and no cookie set. The answer is `no-store`, like every `/api` answer.
 */
export function publicShareRouter(ctx: AppContext): Router {
  const router = express.Router();
  router.get("/", async (req, res) => {
    const body: PublicShareResponse = await loadPublicShare(ctx, req.get(shareSecretHeader) ?? "");
    res.json(body);
  });
  return router;
}
