/** The groups of the API reference, in their order there (OpenAPI tags). */
export const v1Tags = [
  { name: "Profile", description: "The account a credential belongs to." },
  {
    name: "Tokens",
    description:
      "The API token a request carries. Tokens are created, rolled and revoked in Settings › API tokens.",
  },
  {
    name: "Devices",
    description:
      "The phones that record locations (Overland installs), with their latest position and battery.",
  },
  {
    name: "Locations",
    description:
      "Where the devices have been: every point as it arrived, the places they stayed at (visits) and the all-time heatmap. All of it needs `locations:read`.",
  },
  {
    name: "Tracks",
    description:
      "Where the devices went, at a level of calculation: as recorded, averaged, mapped onto roads and railways, or as stops and moves.",
  },
  {
    name: "Timeline",
    description:
      "Stops and moves with their transport modes, the corrections people make to the modes, and distance and time per mode.",
  },
  {
    name: "History",
    description:
      "History without coordinates: trips, daily statistics and recent activity (`history:read`).",
  },
  {
    name: "Insights",
    description:
      "How you travelled: distance, time and moves per transport mode, when you travel and on which roads — worked out from the stops and moves, without coordinates (`history:read`).",
  },
  {
    name: "People",
    description:
      "The people who share their location with you, with their devices at the precision they chose.",
  },
  {
    name: "Sharing",
    description:
      "Your location shared with people (one way, for as long as you choose) and as public links, and the shares people give you.",
  },
  { name: "Reference", description: "This API's own description." },
] as const satisfies readonly { name: string; description: string }[];

export type V1TagName = (typeof v1Tags)[number]["name"];
