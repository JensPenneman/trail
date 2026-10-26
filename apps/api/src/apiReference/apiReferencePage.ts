import { apiPaths } from "@trail/contracts/apiPaths";
import type { ImmutableScript } from "./ImmutableScript";

/**
 * The `/docs` page: a mount point and the scripts, nothing inline (the CSP
 * allows no inline script). The mount point is not `#api-reference`: the
 * bundle's legacy HTML API mounts a second, unconfigured reference into an
 * element with that id, and that one would fetch Scalar's web fonts.
 */
export function apiReferencePage(scripts: readonly ImmutableScript[]): string {
  const tags = scripts
    .map((script) => `    <script src="${apiPaths.docs}/assets/${script.fileName}"></script>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Reference of the Trail API: operations, scopes, errors and limits." />
    <title>Trail API</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <noscript>
      The reference needs JavaScript. The API is described in
      <a href="${apiPaths.v1.openApi}">${apiPaths.v1.openApi}</a> (OpenAPI 3.1).
    </noscript>
    <div id="reference"></div>
${tags}
  </body>
</html>
`;
}
