# Build the shared product as a standalone Next server; no development runtime in the image.
FROM node:24-alpine AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo
COPY . .
ARG MUSEFOLD_API_UPSTREAM=http://api:8787
ARG NEXT_PUBLIC_GIT_COMMIT
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_BUILT_AT
ARG NEXT_PUBLIC_APP_BASE_PATH
ENV MUSEFOLD_API_UPSTREAM=$MUSEFOLD_API_UPSTREAM \
    NEXT_PUBLIC_GIT_COMMIT=$NEXT_PUBLIC_GIT_COMMIT \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_PUBLIC_BUILT_AT=$NEXT_PUBLIC_BUILT_AT \
    NEXT_PUBLIC_APP_BASE_PATH=$NEXT_PUBLIC_APP_BASE_PATH
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @musefold/web-next...
RUN mkdir -p apps/web-next/public
RUN pnpm --filter @musefold/web-next run build

FROM node:24-alpine
RUN addgroup -S musefold && adduser -S musefold -G musefold
WORKDIR /app
COPY --from=build --chown=musefold:musefold /repo/apps/web-next/.next/standalone /app
COPY --from=build --chown=musefold:musefold /repo/apps/web-next/.next/static /app/apps/web-next/.next/static
COPY --from=build --chown=musefold:musefold /repo/apps/web-next/public /app/apps/web-next/public
USER musefold
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "apps/web-next/server.js"]
