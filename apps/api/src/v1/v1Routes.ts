import type { V1Route } from "./defineRoute";
import type { ServedDocument } from "./openapi/servedDocument";
import { deviceRoutes } from "./routes/devices/deviceRoutes";
import { historyRoutes } from "./routes/history/historyRoutes";
import { locationRoutes } from "./routes/locations/locationRoutes";
import { profileRoutes } from "./routes/profile/profileRoutes";
import { getOpenApiDocument } from "./routes/reference/getOpenApiDocument";
import { tokenRoutes } from "./routes/tokens/tokenRoutes";

/**
 * The operations of the public API, in the order of the reference: one group
 * per feature, each kept in `routes/<feature>/<feature>Routes.ts` next to its
 * route modules (docs/architecture.md §8.3). A new feature adds one line here.
 */
const operations: readonly V1Route[] = [
  ...profileRoutes,
  ...tokenRoutes,
  ...deviceRoutes,
  ...locationRoutes,
  ...historyRoutes,
];

/**
 * Every `/api/v1` route: what `createV1Router` mounts and `buildOpenApiDocument`
 * describes — the document's own route included, which serves `served()`.
 */
export function v1Routes(served: () => ServedDocument): readonly V1Route[] {
  return [...operations, getOpenApiDocument(served)];
}
