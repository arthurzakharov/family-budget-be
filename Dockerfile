# syntax=docker/dockerfile:1

FROM oven/bun:1.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info

COPY --from=build /app/dist-server ./
COPY drizzle ./drizzle

ARG GIT_COMMIT_HASH=""
ARG GIT_COMMIT_MESSAGE=""
ARG GIT_COMMIT_AUTHOR=""
ARG GIT_COMMIT_DATE=""
ENV GIT_COMMIT_HASH=$GIT_COMMIT_HASH \
    GIT_COMMIT_MESSAGE=$GIT_COMMIT_MESSAGE \
    GIT_COMMIT_AUTHOR=$GIT_COMMIT_AUTHOR \
    GIT_COMMIT_DATE=$GIT_COMMIT_DATE

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT ?? 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "server.js"]
