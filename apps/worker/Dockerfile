# Musefold v2.5 生图 worker 镜像。
FROM node:24-alpine AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @musefold/worker...
RUN pnpm --filter @musefold/worker deploy --prod --ignore-scripts --legacy /out/worker

FROM node:24-alpine
RUN addgroup -S musefold && adduser -S musefold -G musefold
WORKDIR /app
COPY --from=build --chown=musefold:musefold /out/worker /app
USER musefold
ENV NODE_ENV=production
CMD ["./node_modules/.bin/tsx", "src/bin.ts"]
