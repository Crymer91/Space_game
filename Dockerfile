# --- этап 1: зависимости ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
# --omit=dev: socket.io-client нужен только для локального e2e, в образ не попадает
RUN npm install --omit=dev --no-audit --no-fund

# --- этап 2: рантайм ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/server.db
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
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
