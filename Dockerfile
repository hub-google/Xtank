# Official X-TANK authoritative WebSocket server container.
# Does not package Electron, client UI, QA credentials or any secret.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 BIND_HOST=0.0.0.0
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server/ ./server/
COPY --chown=node:node src/simulation.js ./src/simulation.js
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=8s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.cjs"]
