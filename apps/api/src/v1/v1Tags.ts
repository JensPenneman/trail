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
  { name: "Reference", description: "This API's own description." },
] as const satisfies readonly { name: string; description: string }[];

export type V1TagName = (typeof v1Tags)[number]["name"];
