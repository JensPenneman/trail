import { z } from "zod";

/**
 * Overland lets the server push settings back in the ingest response (`set`).
 * Trail only offers these vetted presets — never ones that could stop the app
 * from checking in again (send_interval=off, tracking_mode=off).
 * The API owns the preset → Overland settings mapping.
 */
export const remoteSettingsPresets = [
  "balanced",
  "balanced-plus",
  "high-resolution",
  "battery-saver",
] as const;
export const remoteSettingsPresetSchema = z.enum(remoteSettingsPresets);
export type RemoteSettingsPreset = z.infer<typeof remoteSettingsPresetSchema>;

export const remoteSettingsPresetInfo: Record<
  RemoteSettingsPreset,
  { label: string; description: string }
> = {
  balanced: {
    label: "Balanced",
    description:
      "Continuous tracking at 100 m accuracy that pauses when you stand still and resumes with a geofence. Sends every 5 minutes.",
  },
  "balanced-plus": {
    label: "Balanced+",
    description:
      "GPS-quality points (10 m) for clean tracks that still pause when you stand still and resume within 100 m; significant-location changes wake Overland if iOS stops it. No blue location indicator. Sends every 5 minutes.",
  },
  "high-resolution": {
    label: "High resolution",
    description:
      "Best accuracy, never pauses, up to one point per second while moving. Detailed tracks; uses a lot of battery.",
  },
  "battery-saver": {
    label: "Battery saver",
    description:
      "Significant-location changes plus visits. Enough to know the neighbourhood; barely any battery. Sends every 10 minutes.",
  },
};
