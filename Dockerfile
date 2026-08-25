# --- этап 1: зависимости ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
# --omit=dev: socket.io-client нужен только для локального e2e, в образ не попадает.
# Нативных модулей нет — Python/node-gyp/компилятор не требуются.
RUN npm install --omit=dev --no-audit --no-fund

# --- этап 2: рантайм ---
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/server.db.json
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json config.js ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null 2>&1 || exit 1
CMD ["node", "src/server.js"]
