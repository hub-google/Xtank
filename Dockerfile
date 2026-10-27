# Multistage build: compile shared browser simulation for the server before packaging.
# server/engine.cjs is gitignored and MUST be built inside the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY scripts/build-server.cjs ./scripts/build-server.cjs
COPY src/simulation.js ./src/simulation.js
RUN npm run build:server

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 BIND_HOST=0.0.0.0 XTANK_SETTLEMENT_DIR=/data/settlements
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force \
    && mkdir -p /data/settlements && chown -R node:node /data
COPY --chown=node:node server/ ./server/
COPY --from=build --chown=node:node /app/server/engine.cjs ./server/engine.cjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=8s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.cjs"]
