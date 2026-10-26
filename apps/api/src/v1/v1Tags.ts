/** The groups of the API reference, in their order there (OpenAPI tags). */
export const v1Tags = [
  { name: "Profile", description: "The account a credential belongs to." },
  {
    name: "Devices",
    description:
      "The phones that record locations (Overland installs), with their latest position and battery.",
  },
  { name: "Reference", description: "This API's own description." },
] as const satisfies readonly { name: string; description: string }[];

export type V1TagName = (typeof v1Tags)[number]["name"];
