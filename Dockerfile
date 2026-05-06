# --- build stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install build deps (only the lockfile context for caching)
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Strip dev deps for a smaller runtime image
RUN npm prune --omit=dev

# --- runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy only what's needed at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Migrations are bundled so we can run them once after first deploy
COPY migrations ./migrations
COPY scripts/migrate.ts ./scripts/migrate.ts

EXPOSE 3000

# Drop to non-root for security
USER node

CMD ["node", "dist/main.js"]
