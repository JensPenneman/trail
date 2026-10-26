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
    name: "History",
    description:
      "History without coordinates: trips, daily statistics and recent activity (`history:read`).",
  },
  { name: "Reference", description: "This API's own description." },
] as const satisfies readonly { name: string; description: string }[];

export type V1TagName = (typeof v1Tags)[number]["name"];
