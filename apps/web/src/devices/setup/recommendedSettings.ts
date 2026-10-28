import type { DeviceApp } from "@trail/contracts/deviceApp";
import { type OwnTracksProfile, owntracksTracking } from "@trail/contracts/owntracksSetup";
import { traccarTracking } from "@trail/contracts/traccarSetup";

interface RecommendedSetting {
  /** The setting's name as the app shows it. */
  name: string;
  value: string;
  why?: string;
}

export interface RecommendedSettingsList {
  title: string;
  intro: string;
  settings: readonly RecommendedSetting[];
}

/*
 * What Trail needs from every app for good tracks and transport modes: a point
 * every 10 to 30 seconds while moving, at most about 30 m apart, at the best
 * accuracy — and nothing that makes the phone drop points it could not send.
 * The numbers of OwnTracks and Traccar Client come from the same constants as
 * their setup links.
 */
const ios = owntracksTracking.ios;
const android = owntracksTracking.android;

const overland: RecommendedSettingsList = {
  title: "Recommended Overland settings",
  intro:
    "The setup code fills in the connection only. These give detailed tracks without draining the battery; later you can also send a preset to the phone from the device’s Tracking settings.",
  settings: [
    {
      name: "Logging mode",
      value: "All Data",
      why: "Required: Trail reads Overland’s full batch format.",
    },
    {
      name: "Tracking mode",
      value: "Standard",
      why: "Continuous tracking; the phone decides when to pause.",
    },
    { name: "Desired accuracy", value: "100 m" },
    {
      name: "Pause updates automatically",
      value: "On",
      why: "Saves battery while you stand still.",
    },
    { name: "Resume with geofence", value: "200 m" },
    { name: "Visit tracking", value: "On", why: "Adds the places you stayed to History." },
    { name: "Points per batch", value: "200" },
    { name: "Send interval", value: "5 minutes" },
    { name: "Minimum distance / time", value: "10 m / 5 s" },
  ],
};

/* The iPhone's settings but for monitoring, which the two setup links differ in. */
const owntracksIosSettings = (monitoring: RecommendedSetting): readonly RecommendedSetting[] => [
  { name: "Mode", value: "HTTP", why: "Required: Trail speaks OwnTracks’ HTTP mode." },
  { name: "Authentication", value: "Off", why: "The access token goes in the HTTP Headers." },
  { name: "HTTP Headers", value: "Authorization: Bearer <access token>" },
  monitoring,
  {
    name: "locatorDisplacement",
    value: `${ios.locatorDisplacement} m`,
    why: "In Move, a point after every 30 m.",
  },
  {
    name: "locatorInterval",
    value: `${ios.locatorInterval} s`,
    why: "And at least one a minute.",
  },
  { name: "extendedData", value: "On", why: "Adds battery, Wi-Fi and motion activity." },
  {
    name: "Location access",
    value: "Always, Precise",
    why: "Set in the iPhone’s Settings › OwnTracks.",
  },
  { name: "Motion & Fitness", value: "On", why: "For the motion activity." },
];

const owntracksIos: RecommendedSettingsList = {
  title: "Recommended OwnTracks settings on an iPhone",
  intro:
    "The setup link sets these. Move records the detail Trail needs to tell walking from cycling from driving; GPS stays on, which costs a lot of battery.",
  settings: owntracksIosSettings({
    name: "Monitoring",
    value: "Move",
    why: "GPS stays on while tracking: detailed tracks, high battery use.",
  }),
};

const owntracksIosSignificant: RecommendedSettingsList = {
  title: "Recommended OwnTracks settings on an iPhone",
  intro:
    "The setup link sets these. Significant changes reports every few hundred metres or minutes for very little battery: enough for where you were, not for how you travelled. Switch to Move in OwnTracks when you want a detailed track.",
  settings: owntracksIosSettings({
    name: "Monitoring",
    value: "Significant changes",
    why: "iOS decides when to report: low battery use, sparse points.",
  }),
};

const owntracksAndroid: RecommendedSettingsList = {
  title: "Recommended OwnTracks settings on Android",
  intro:
    "The setup link sets these. Significant changes monitoring with this locator reports every 15 to 30 seconds while you move and nothing while you stand still; Move mode would report every interval, moving or not.",
  settings: [
    {
      name: "Connection › Mode",
      value: "HTTP",
      why: "Required: Trail speaks OwnTracks’ HTTP mode.",
    },
    {
      name: "Monitoring mode",
      value: "Significant changes",
      why: "Switched with the button on the map.",
    },
    { name: "Location interval", value: `${android.locatorInterval} s` },
    {
      name: "Minimal location displacement",
      value: `${android.locatorDisplacement} m`,
      why: "Nothing while you stand still.",
    },
    {
      name: "Location interval (Move mode)",
      value: `${android.moveModeLocatorInterval} s`,
      why: "Should you switch to Move.",
    },
    {
      name: "Limit max locator frequency",
      value: "On",
      why: "No more points than the interval asks for.",
    },
    {
      name: "Locator priority",
      value: "High accuracy",
      why: "Set by the link: GPS rather than Wi-Fi and cell towers.",
    },
    { name: "Reporting › Extended data", value: "On", why: "Adds battery and Wi-Fi." },
    {
      name: "Battery use of the app",
      value: "Unrestricted",
      why: "Android otherwise stops it in the background.",
    },
  ],
};

const traccar: RecommendedSettingsList = {
  title: "Recommended Traccar Client settings",
  intro:
    "The setup link sets the first six. With the highest accuracy Traccar Client sends a point after 30 m, 30 s or a 30° turn, whichever comes first, and pauses while you stand still.",
  settings: [
    { name: "Location accuracy", value: "Highest", why: "Every fix, filtered by the three below." },
    { name: "Distance", value: `${traccarTracking.distance} m` },
    { name: "Interval", value: `${traccarTracking.interval} s` },
    { name: "Angle", value: `${traccarTracking.angle}°`, why: "Keeps the corners of a route." },
    {
      name: "Offline buffering",
      value: "On",
      why: "Keeps points without a connection and sends them later.",
    },
    { name: "Stop detection", value: "On", why: "Saves battery while you stand still." },
    { name: "Stationary heartbeat", value: "Off" },
    {
      name: "Location access",
      value: "All the time, precise",
      why: "Without it, tracking stops in the background.",
    },
  ],
};

const osmand: RecommendedSettingsList = {
  title: "Recommended OsmAnd settings",
  intro:
    "OsmAnd sends points only while it records a trip: start one in the Trip recording widget or menu. These are in the Trip recording plugin’s settings.",
  settings: [
    { name: "Online tracking", value: "On" },
    { name: "Tracking interval", value: "10 seconds", why: "How often OsmAnd sends a point." },
    {
      name: "Time buffer",
      value: "The longest offered",
      why: "OsmAnd drops points it could not send within it.",
    },
    { name: "Logging interval", value: "5 seconds or less" },
    { name: "Logging minimum displacement", value: "Off" },
    {
      name: "Logging minimum accuracy",
      value: "Off",
      why: "Trail weighs every point’s accuracy itself.",
    },
    {
      name: "Logging minimum speed",
      value: "Off",
      why: "Otherwise stops and slow stretches go missing.",
    },
  ],
};

const gpslogger: RecommendedSettingsList = {
  title: "Recommended GPSLogger settings",
  intro:
    "Under Logging details › Log to custom URL, and Performance. GPSLogger sends every point it logs; with these it logs one every 15 seconds while you move and none while you stand still.",
  settings: [
    { name: "Log to custom URL", value: "On" },
    { name: "HTTP Method", value: "GET" },
    {
      name: "Discard offline locations",
      value: "Off",
      why: "Points logged offline are sent later.",
    },
    { name: "Logging interval", value: "15 s" },
    { name: "Distance filter", value: "25 m", why: "Nothing while you stand still." },
    { name: "Accuracy filter", value: "50 m" },
    {
      name: "Keep GPS on between fixes",
      value: "On",
      why: "With an interval this short, GPS would start cold for every point.",
    },
    { name: "Location providers", value: "GPS/GNSS" },
  ],
};

/** The settings Trail recommends for an app (and, for OwnTracks, the phone and how it tracks). */
export function recommendedSettings(
  app: DeviceApp,
  owntracksProfile: OwnTracksProfile = "ios",
): RecommendedSettingsList {
  switch (app) {
    case "overland":
      return overland;
    case "owntracks":
      return {
        ios: owntracksIos,
        iosSignificant: owntracksIosSignificant,
        android: owntracksAndroid,
      }[owntracksProfile];
    case "traccar":
      return traccar;
    case "osmand":
      return osmand;
    case "gpslogger":
      return gpslogger;
  }
}
