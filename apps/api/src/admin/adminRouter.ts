import type { AdminUserListResponse } from "@trail/contracts/adminUser";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreateInviteResponse,
  createInviteRequestSchema,
  type InviteListResponse,
} from "@trail/contracts/invite";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAdmin } from "../auth/requestAuth";
import { invites } from "../db/schema/invites";
import { users } from "../db/schema/users";
import { toIso, toIsoOrNull } from "../db/toIso";
import { notFound } from "../http/httpError";
import { parseBody } from "../http/parseInput";
import { isUuid } from "../lib/isUuid";
import { createInvite } from "./createInvite";
import { toInvite } from "./toInvite";

interface AdminUserRow extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  devices: number;
  passkeys: number;
  last_seen_at: string | null;
}

/** `/api/admin/*` — invites and the user list (administrators only). */
export function adminRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;
  const usedBy = alias(users, "used_by_user");

  router.get(apiPaths.admin.invites, async (req, res) => {
    requireAdmin(req);
    const rows = await db
      .select({ invite: invites, usedByEmail: usedBy.email })
      .from(invites)
      .leftJoin(usedBy, eq(usedBy.id, invites.usedBy))
      .orderBy(desc(invites.createdAt));
    const body: InviteListResponse = {
      invites: rows.map((row) => toInvite(row.invite, row.usedByEmail)),
    };
    res.json(body);
  });

  router.post(apiPaths.admin.invites, async (req, res) => {
    const { user } = requireAdmin(req);
    const request = parseBody(createInviteRequestSchema, req);
    const { invite, url } = await createInvite(db, {
      email: request.email ?? null,
      expiresInDays: request.expiresInDays,
      createdBy: user.id,
      publicUrl: ctx.config.publicUrl,
    });
    const body: CreateInviteResponse = { invite: toInvite(invite, null), url };
    res.status(201).json(body);
  });

  router.delete("/api/admin/invites/:id", async (req, res) => {
    requireAdmin(req);
    const inviteId = req.params.id;
    if (!isUuid(inviteId)) throw notFound("No such invite.");
    const [deleted] = await db
      .delete(invites)
      .where(eq(invites.id, inviteId))
      .returning({ id: invites.id });
    if (deleted === undefined) throw notFound("No such invite.");
    res.status(204).end();
  });

  router.get(apiPaths.admin.users, async (req, res) => {
    requireAdmin(req);
    const result = await db.execute<AdminUserRow>(sql`
      SELECT u.id, u.email, u.display_name, u.is_admin, u.created_at,
        (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
        (SELECT count(*)::int FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
        (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
      FROM users u
      ORDER BY u.created_at, u.id
    `);
    const body: AdminUserListResponse = {
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isAdmin: row.is_admin,
        createdAt: toIso(row.created_at),
        devices: row.devices,
        passkeys: row.passkeys,
        lastSeenAt: toIsoOrNull(row.last_seen_at),
      })),
    };
    res.json(body);
  });

  return router;
}
