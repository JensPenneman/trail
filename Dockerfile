# syntax=docker/dockerfile:1

# Trail production image: the bundled API plus the built SPA it serves.
#
# Every build stage runs on the build machine's own platform ($BUILDPLATFORM).
# The artefacts are plain JavaScript, so a single build serves linux/amd64 and
# linux/arm64 and nothing runs under emulation; the final stage only copies
# files. Node is always the current LTS: the tag stays `lts-alpine` and
# Dependabot moves the pinned digest when a new image is published.

FROM --platform=$BUILDPLATFORM node:lts-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS manifests
WORKDIR /app
# Only the manifests, so the install layers stay cached until a package.json
# or the lockfile changes. npm ci needs every workspace manifest to validate
# the lockfile, even when it installs a single workspace.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

# The basemap's fonts and sprites (docs/design/self-hosted-maps.md section 3.2):
# the files scripts/map-assets.json pins by SHA-256, downloaded in a layer of
# their own that only a change of the two files below invalidates, so an image
# build fetches them once per change rather than once per commit.
FROM --platform=$BUILDPLATFORM node:lts-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS map-assets
WORKDIR /app
COPY scripts/map-assets.mjs scripts/map-assets.json scripts/
RUN TRAIL_MAP_ASSETS_CACHE=/map-assets node scripts/map-assets.mjs download

FROM manifests AS build
# Lifecycle scripts are skipped: the dependencies need none (native tools ship
# as optional platform packages) and the root `prepare` only installs git hooks.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# The build lays the map assets out from that layer (apps/web/dist/map-assets),
# hashing every file again; it downloads nothing.
RUN --mount=type=bind,from=map-assets,source=/map-assets,target=/map-assets \
    TRAIL_MAP_ASSETS_CACHE=/map-assets npm run build \
    && mkdir -p /out/map

FROM manifests AS runtime-deps
# Production dependencies of the API only. The workspace links npm creates are
# dropped: the bundle inlines @trail/contracts and nothing imports the others.
# These modules are installed on the build platform and copied into images for
# every target platform, so they must be pure JavaScript: a native addon
# (*.node) fails the build instead of shipping for the wrong CPU.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --workspace @trail/api --ignore-scripts --no-audit --no-fund \
    && rm -rf node_modules/@trail \
    && find node_modules -name '*.node' -exec sh -c 'printf "native addon in the runtime dependencies: %s\n" "$@" >&2; exit 1' sh {} +

# A build without BUILD_TIME (from source, as Launchway does it) stamps its own
# time; the API reads apps/api/dist/build-time when BUILD_TIME is empty. A stage
# of its own, on the build platform, so the final stage keeps no RUN step and
# both platforms still build without emulation. The step mounts everything the
# final stage ships (the built API and SPA, the production node_modules, the
# migrations and the package.json files), so its cache key follows the shipped
# content: a change of any of it gets a new stamp, and an edit that changes
# nothing shipped keeps the stamp. GIT_SHA is part of the key as well, so a
# commit that changes no shipped file still gets a new stamp on the server.
# The stamp goes into a directory of its own, so nothing else reaches dist.
FROM --platform=$BUILDPLATFORM node:lts-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build-time
ARG GIT_SHA=""
ARG BUILD_TIME=""
RUN --mount=type=bind,from=build,source=/app/apps/api/dist,target=/shipped/api-dist \
    --mount=type=bind,from=build,source=/app/apps/web/dist,target=/shipped/web-dist \
    --mount=type=bind,from=build,source=/app/apps/api/drizzle,target=/shipped/drizzle \
    --mount=type=bind,from=build,source=/app/package.json,target=/shipped/package.json \
    --mount=type=bind,from=build,source=/app/apps/api/package.json,target=/shipped/api-package.json \
    --mount=type=bind,from=runtime-deps,source=/app/node_modules,target=/shipped/node_modules \
    mkdir /stamp \
    && : "commit ${GIT_SHA}" \
    && if [ -z "$BUILD_TIME" ]; then date -u +%Y-%m-%dT%H:%M:%SZ > /stamp/build-time; fi

FROM node:lts-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# Everything stays owned by root: the app (user node) can read but never
# modify its own code, independent of the read-only root filesystem.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# The map data's volume (MAP_DATA_DIR): the one directory the app writes, so
# the mount point is the app user's, and a new named volume takes that owner.
COPY --from=build --chown=1000:1000 /out/map /var/lib/trail/map
# `docker compose exec app trail <command>` runs the management CLI, and
# `trail worker` is the worker's command (docs/architecture.md section 3)
COPY --chmod=0755 <<'EOF' /usr/local/bin/trail
#!/bin/sh
exec node --enable-source-maps /app/apps/api/dist/cli.mjs "$@"
EOF

# uid/gid 1000 = the image's unprivileged `node` user (numeric, so a runtime
# can verify it is not root)
USER 1000:1000
EXPOSE 8080
STOPSIGNAL SIGTERM
# Liveness for both roles: the API's /api/health/live, which never touches the
# database, so a database outage does not get the app container restarted —
# or, in a worker (`trail worker`, no HTTP server), its own /health/live on
# PROCESSING_METRICS_PORT, which fails once its heartbeat is 90 s old.
# deploy/compose.yaml gives each service its half; this covers any other run.
# busybox wget avoids starting a second Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["/bin/sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT}/api/health/live\" || wget -q -O /dev/null \"http://127.0.0.1:${PROCESSING_METRICS_PORT:-8081}/health/live\" || exit 1"]
CMD ["node", "--enable-source-maps", "apps/api/dist/main.mjs"]

# Build metadata last: it changes on every build and must not invalidate the
# layers above. CI passes all three; an empty value means "not set" to the app,
# and an unset APP_VERSION (a build from source, as Launchway does it, passes
# only GIT_SHA) reports the package.json version the build stage bundled into
# the API (apps/api/src/config/buildDefaults.ts), so /api/config names the
# version of the checked-out ref. The image label stays empty then. An empty
# BUILD_TIME is replaced by the time of the build (the build-time stage).
ARG APP_VERSION=""
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}
LABEL org.opencontainers.image.title="Trail" \
      org.opencontainers.image.description="Self-hosted location history for the Overland GPS tracker: passkey sign-in, live dashboard and map history." \
      org.opencontainers.image.source="https://github.com/JensPenneman/trail" \
      org.opencontainers.image.url="https://github.com/JensPenneman/trail" \
      org.opencontainers.image.documentation="https://github.com/JensPenneman/trail/blob/main/docs/operations.md" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
# The build time stamped by the build-time stage (nothing when BUILD_TIME was
# passed); it is last, so only this layer changes between builds, and it stays
# owned by root like the rest of the code.
COPY --from=build-time /stamp/ ./apps/api/dist/
