import { z } from "zod";
import { heatMeasureSchema } from "./heatmap";
import { processingLevelSchema } from "./transport";

/*
 * Preferences (docs/architecture.md §14): defaults an account takes to every
 * browser it signs in on. The web app resolves each one in this order: the
 * address (`?style=`, `?level=`), the choice last made on this browser, the
 * preference, the built-in default below.
 */

/** The map's styles: Auto follows the system's light or dark setting; Satellite needs the server's imagery. */
export const mapStyles = ["auto", "light", "dark", "satellite"] as const;
export const mapStyleSchema = z.enum(mapStyles);
export type MapStyle = z.infer<typeof mapStyleSchema>;

/** What the paths on the map are coloured by (the options a level supports; the rest are skipped). */
export const pathColours = [
  "mode",
  "device",
  "speed",
  "time",
  "altitude",
  "accuracy",
  "confidence",
] as const;
export const pathColourSchema = z.enum(pathColours);
export type PathColour = z.infer<typeof pathColourSchema>;

/**
 * An account's preferences, each one filled in: what `SessionUser.preferences`
 * carries. A preference that is not there takes its default.
 */
export const preferencesSchema = z.object({
  /** The map's style where neither the address nor this browser has one. */
  mapStyle: mapStyleSchema.default("auto"),
  /** The level of the tracks where neither the address nor this browser has one. */
  level: processingLevelSchema.default("inferred"),
  /** What the heatmap counts where neither the address nor this browser has a choice. */
  heat: heatMeasureSchema.default("points"),
  /** What the paths are coloured by where neither the address nor this browser has a choice. */
  color: pathColourSchema.default("mode"),
  /** Whether the access log lists the account's own activity too, not only other people's. */
  showOwnActivity: z.boolean().default(false),
});
export type Preferences = z.output<typeof preferencesSchema>;

/** What a preference that was never set reads as. */
export const defaultPreferences: Readonly<Preferences> = preferencesSchema.parse({});

/**
 * `PATCH /api/me` `preferences`: the ones to change, the others stay as they
 * are. An unknown name is refused, so nothing but these is ever stored.
 */
export const preferencesUpdateSchema = z.strictObject({
  mapStyle: mapStyleSchema.optional(),
  level: processingLevelSchema.optional(),
  heat: heatMeasureSchema.optional(),
  color: pathColourSchema.optional(),
  showOwnActivity: z.boolean().optional(),
});
export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;
