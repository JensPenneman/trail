import { z } from "zod";

/** `GET /api/admin/users` */
export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  createdAt: z.iso.datetime(),
  devices: z.number().int().nonnegative(),
  passkeys: z.number().int().nonnegative(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListResponseSchema = z.object({ users: z.array(adminUserSchema) });
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
