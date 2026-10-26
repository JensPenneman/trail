import { z } from "zod";

/** The account behind a credential, as the public API (v1) shows it. */
export const profileSchema = z
  .object({
    id: z.uuid().meta({
      description: "The account's id.",
      example: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
    }),
    displayName: z.string().meta({ description: "The name the person chose.", example: "Jens" }),
    timezone: z.string().meta({
      description: "IANA time zone; the account's local days and times use it.",
      example: "Europe/Brussels",
    }),
  })
  .meta({ id: "Profile", description: "The account a credential belongs to." });
export type Profile = z.infer<typeof profileSchema>;

/** `GET /api/v1/me` */
export const profileResponseSchema = z.object({ user: profileSchema });
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
