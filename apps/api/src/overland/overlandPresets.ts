import type { RemoteSettingsPreset } from "@trail/contracts/remoteSettings";

/** The `set` object of an ok-response: Overland applies these settings (value vocabularies from its README). */
export interface OverlandSettings {
  send_interval: string;
  main: Record<string, string | number | boolean>;
}

/*
 * Vetted presets only: none of them can switch tracking or sending off, so a
 * phone can always check in again (docs/architecture.md §6.3).
 */
const presets: Readonly<Record<RemoteSettingsPreset, OverlandSettings>> = {
  balanced: {
    send_interval: "5m",
    main: {
      tracking_mode: "standard",
      visit_tracking: true,
      desired_accuracy: "100m",
      activity_type: "other",
      pause_automatically: true,
      resume_with_geofence: "200m",
      logging_mode: "all",
      batch_size: 200,
      min_distance: "10m",
      min_time: "5s",
    },
  },
  // Balanced with GPS-quality fixes: pauses still, resumes after 100 m, and
  // "both" adds significant-change wake-ups, which keep tracking alive without
  // the background indicator
  "balanced-plus": {
    send_interval: "5m",
    main: {
      tracking_mode: "both",
      visit_tracking: true,
      desired_accuracy: "10m",
      activity_type: "other",
      background_indicator: false,
      pause_automatically: true,
      resume_with_geofence: "100m",
      logging_mode: "all",
      batch_size: 500,
      min_distance: "10m",
      min_time: "1s",
    },
  },
  "high-resolution": {
    send_interval: "1m",
    main: {
      tracking_mode: "standard",
      visit_tracking: true,
      desired_accuracy: "best",
      activity_type: "other",
      background_indicator: true,
      pause_automatically: false,
      resume_with_geofence: "off",
      logging_mode: "all",
      batch_size: 500,
      min_distance: "off",
      min_time: "1s",
    },
  },
  "battery-saver": {
    send_interval: "10m",
    main: {
      tracking_mode: "significant",
      visit_tracking: true,
      desired_accuracy: "100m",
      activity_type: "other",
      pause_automatically: true,
      resume_with_geofence: "500m",
      logging_mode: "all",
      batch_size: 200,
      min_distance: "off",
      min_time: "1s",
    },
  },
};

export function presetSettings(preset: RemoteSettingsPreset): OverlandSettings {
  const settings = presets[preset];
  return { send_interval: settings.send_interval, main: { ...settings.main } };
}
