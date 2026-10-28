/**
 * A region of the map data artefacts (docs/design/self-hosted-maps.md §4):
 * lowercase letters, digits and dashes, as `scripts/mapdata/regions.json`
 * names them, so a region can be part of a tag and of a directory name.
 */
const regionNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const isRegionName = (value: string): boolean => regionNamePattern.test(value);

/**
 * The world overview (a basemap at zoom 0–6, no ways): pulled with every
 * region and never imported into the map tables.
 */
export const worldRegion = "world";
