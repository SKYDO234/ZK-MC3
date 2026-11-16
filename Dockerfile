# ---------- ZK-MC3-PANEL | Dockerfile ----------
# Multi-stage build: compile the Vite/Tailwind front-end and the TypeScript
# back-end, then ship a slim runtime image with OpenJDK for Minecraft servers.
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html server.ts ./
COPY src ./src
COPY public ./public

RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=6767 \
    JAVA_BIN=java

# OpenJDK 21 is what modern Minecraft (1.20.5+) requires; 17 is kept for older jars.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-21-jre-headless tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY agent ./agent
COPY scripts ./scripts

# Persistent state: server files, backups, logs, panel database.
RUN mkdir -p /app/.data && chown -R node:node /app
VOLUME ["/app/.data"]
USER node

EXPOSE 6767
# Minecraft server port range used by the built-in allocator (26000-26999).
EXPOSE 26000-26999

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "server.ts"]
