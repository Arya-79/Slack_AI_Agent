# syntax=docker/dockerfile:1

# ---- Dependencies (production only) ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as the built-in unprivileged user rather than root.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json index.js ./
COPY --chown=node:node src ./src

USER node
EXPOSE 3000

# Socket Mode means no inbound Slack traffic, but the health endpoint is a
# cheap liveness signal for orchestrators.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
