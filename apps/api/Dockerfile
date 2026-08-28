# Musefold v2.5 API 镜像:pnpm deploy 产出隔离包,tsx 直跑 TS 源(无独立构建步)。
FROM node:24-alpine AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @musefold/api...
RUN pnpm --filter @musefold/api deploy --prod --ignore-scripts --legacy /out/api

FROM node:24-alpine
RUN addgroup -S musefold && adduser -S musefold -G musefold
WORKDIR /app
COPY --from=build --chown=musefold:musefold /out/api /app
USER musefold
ENV NODE_ENV=production
EXPOSE 8787
CMD ["./node_modules/.bin/tsx", "src/bin.ts"]
