import { remoteSettingsPresets } from "@trail/contracts/remoteSettings";
import { describe, expect, it } from "vitest";
import { presetSettings } from "../../src/overland/overlandPresets";

describe("presetSettings", () => {
  it("never switches sending or tracking off", () => {
    for (const preset of remoteSettingsPresets) {
      const settings = presetSettings(preset);
      expect(settings.send_interval).not.toBe("off");
      expect(settings.main["tracking_mode"]).not.toBe("off");
      expect(settings.main["logging_mode"]).toBe("all");
      expect(settings.main["visit_tracking"]).toBe(true);
    }
  });

  it("maps the presets of the specification", () => {
    expect(presetSettings("balanced")).toEqual({
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
    });
    expect(presetSettings("balanced-plus")).toEqual({
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
    });
    expect(presetSettings("high-resolution")).toMatchObject({
      send_interval: "1m",
      main: { desired_accuracy: "best", background_indicator: true, pause_automatically: false },
    });
    expect(presetSettings("battery-saver")).toMatchObject({
      send_interval: "10m",
      main: { tracking_mode: "significant", resume_with_geofence: "500m" },
    });
  });

  it("returns a copy that callers may not use to change the preset", () => {
    presetSettings("balanced").main["batch_size"] = 1;
    expect(presetSettings("balanced").main["batch_size"]).toBe(200);
  });
});
