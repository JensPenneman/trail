import { z } from "zod";
import { timeZoneSchema } from "./datetime";
import { emailSchema } from "./email";

/** The signed-in person (`GET /api/auth/session`, `GET /api/me`). */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  /** IANA zone used for "today", day boundaries and all displayed times. */
  timezone: z.string(),
  createdAt: z.iso.datetime(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({ user: sessionUserSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** `PATCH /api/me` */
export const updateMeRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateMeRequest = z.input<typeof updateMeRequestSchema>;

/** `DELETE /api/me` — deletes the account and every device and point. The email must be retyped. */
export const deleteAccountRequestSchema = z.object({ confirmEmail: emailSchema });
export type DeleteAccountRequest = z.input<typeof deleteAccountRequestSchema>;
