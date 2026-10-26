# Development container (compose.yaml next to this file, scripts/devc.sh):
# Node LTS and the Chromium of the end-to-end suite, so that every check of
# the repository runs inside Docker.
#
# Base: node:lts on Debian 13 (trixie), slim. Node is always the current LTS,
# like .nvmrc and the production image, and Dependabot moves the pinned
# digest. Debian is named rather than floating, so the browsers' system
# packages always resolve against a release Playwright supports.
# mcr.microsoft.com/playwright, the image of CI's e2e job, was the other
# option: its Node is the major Playwright chose when it built the image, not
# the current LTS, and it carries Firefox and WebKit, which the suite never
# starts here: 937 MB compressed for arm64, against 329 MB for this image.

FROM node:lts-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS playwright
# The browsers must be the build that the locked Playwright drives, so they
# come from the lockfile's own playwright-core (it has no dependencies). Its
# lockfile entry, and nothing else, is handed on as a project of one package:
# a lockfile change that leaves Playwright alone keeps the browser layer
# cached, and `npm ci` checks the tarball against the entry's integrity
# (sha512). Given just the tarball's URL, npx would run whatever it serves.
COPY package-lock.json /tmp/
RUN node <<'EOF'
const fs = require("node:fs");
const { packages } = require("/tmp/package-lock.json");
// A dependency of its own project here, not a development one
const { dev, ...entry } = packages["node_modules/playwright-core"];
const project = {
  name: "playwright-browsers",
  private: true,
  dependencies: { "playwright-core": entry.version },
};
const lockfile = {
  name: project.name,
  lockfileVersion: 3,
  requires: true,
  packages: { "": project, "node_modules/playwright-core": entry },
};
fs.mkdirSync("/tmp/playwright");
fs.writeFileSync("/tmp/playwright/package.json", JSON.stringify(project));
fs.writeFileSync("/tmp/playwright/package-lock.json", JSON.stringify(lockfile));
EOF

FROM node:lts-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea
# Outside every home directory and volume, owned by root, shared by all users
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=playwright /tmp/playwright /tmp/playwright
# The suite's projects run in Chromium, headless, so its headless shell is
# enough; --with-deps adds the system packages, which apt checks against
# Debian's signed archive. The lockfile's sha512 covers playwright-core; that
# verified package pins the browser build (its browsers.json) and fetches it
# over HTTPS from Playwright's CDN, which hands Chrome for Testing builds over
# to Google's storage, with a size check only: Playwright compares the byte
# count with Content-Length, and neither Playwright nor Chrome for Testing
# publishes a checksum. The `webkit` project of playwright.config.ts only
# exists for a deployment on another port (E2E_BASE_URL), and WebKit with its
# packages would double the image.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    cd /tmp/playwright \
    && npm ci --ignore-scripts --no-audit --no-fund --no-update-notifier \
    && node_modules/.bin/playwright-core install --with-deps --only-shell chromium \
    && cd / \
    && rm -rf /var/lib/apt/lists/* /tmp/playwright

# The image's `node` user. Docker Desktop shows files the container creates in
# the bind mount as the host user's whatever the uid; a Linux host sees the uid
# itself, so scripts/devc.sh passes the caller's own ids there.
ARG USER_UID=1000
ARG USER_GID=1000
# A new volume takes the owner of the directory it is mounted on: the module
# volumes of compose.yaml must belong to `node`, or `npm ci` cannot write them.
RUN if [ "$USER_UID:$USER_GID" != 1000:1000 ]; then \
        groupmod --non-unique --gid "$USER_GID" node \
        && usermod --non-unique --uid "$USER_UID" --gid "$USER_GID" node \
        && chown -R node:node /home/node; \
    fi \
    && install -d -o node -g node \
        /workspaces/trail/node_modules \
        /workspaces/trail/apps/api/node_modules \
        /workspaces/trail/apps/web/node_modules \
        /workspaces/trail/packages/contracts/node_modules

# scripts/dev.mjs and scripts/hooks.mjs adapt to the container; npm comes
# with the image's Node, so its update notice would only be noise.
ENV TRAIL_DEVCONTAINER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
WORKDIR /workspaces/trail
CMD ["sleep", "infinity"]
