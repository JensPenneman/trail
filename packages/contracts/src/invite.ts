import { z } from "zod";
import { emailSchema } from "./email";

/** An invitation to create an account (admins only). */
export const inviteSchema = z.object({
  id: z.uuid(),
  /** When set, only this address can use the invite. */
  email: z.email().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
  usedByEmail: z.email().nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const inviteListResponseSchema = z.object({ invites: z.array(inviteSchema) });
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

/** `POST /api/admin/invites` */
export const createInviteRequestSchema = z.object({
  email: emailSchema.optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type CreateInviteRequest = z.input<typeof createInviteRequestSchema>;

/** The URL (with the secret token) is only ever returned here. */
export const createInviteResponseSchema = z.object({ invite: inviteSchema, url: z.url() });
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;
