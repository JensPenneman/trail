import { z } from "zod";

/** An email address, normalised (trimmed + lower-cased) before validation. It is the account identifier. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
