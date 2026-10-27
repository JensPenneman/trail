import { defaultPreferences, mapStyleSchema, type Preferences } from "@trail/contracts/preferences";
import { processingLevelSchema } from "@trail/contracts/transport";
import { z } from "zod";

/*
 * `users.preferences` holds what the person set and nothing else. Read, every
 * preference is filled in: one never set takes its default, and so does a
 * value this version no longer knows (a downgrade, a name of a later
 * release); anything else stored is left out.
 */
const storedPreferencesSchema = z
  .object({
    mapStyle: mapStyleSchema.catch(defaultPreferences.mapStyle),
    level: processingLevelSchema.catch(defaultPreferences.level),
    showOwnActivity: z.boolean().catch(defaultPreferences.showOwnActivity),
  })
  .catch({ ...defaultPreferences });

/** An account's preferences as `SessionUser.preferences` carries them. */
export function readPreferences(stored: unknown): Preferences {
  return storedPreferencesSchema.parse(stored);
}
