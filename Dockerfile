# syntax=docker/dockerfile:1

# Trail production image: the bundled API plus the built SPA it serves.
#
# Every build stage runs on the build machine's own platform ($BUILDPLATFORM).
# The artefacts are plain JavaScript, so a single build serves linux/amd64 and
# linux/arm64 and nothing runs under emulation; the final stage only copies
# files. Node is always the current LTS: the tag stays `lts-alpine` and
# Dependabot moves the pinned digest when a new image is published.

FROM --platform=$BUILDPLATFORM node:lts-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS manifests
WORKDIR /app
# Only the manifests, so the install layers stay cached until a package.json
# or the lockfile changes. npm ci needs every workspace manifest to validate
# the lockfile, even when it installs a single workspace.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

FROM manifests AS build
# Lifecycle scripts are skipped: the dependencies need none (native tools ship
# as optional platform packages) and the root `prepare` only installs git hooks.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

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

FROM node:lts-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
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
# `docker compose exec app trail <command>` runs the management CLI
COPY --chmod=0755 <<'EOF' /usr/local/bin/trail
#!/bin/sh
exec node --enable-source-maps /app/apps/api/dist/cli.mjs "$@"
EOF

# uid/gid 1000 = the image's unprivileged `node` user (numeric, so a runtime
# can verify it is not root)
USER 1000:1000
EXPOSE 8080
STOPSIGNAL SIGTERM
# /api/health/live never touches the database, so a database outage does not
# get the app container restarted; busybox wget avoids starting a second Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["/bin/sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT}/api/health/live\" || exit 1"]
CMD ["node", "--enable-source-maps", "apps/api/dist/main.mjs"]

# Build metadata last: it changes on every build and must not invalidate the
# layers above. CI passes all three; an empty value means "not set" to the app.
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
