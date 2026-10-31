# One image serves the API, the worker and the built frontend, so the session cookie stays on a single origin.

FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && cp -r src/db/migrations dist/src/db/migrations
RUN npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production STATIC_DIR=/app/public
WORKDIR /app
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/package.json ./package.json
COPY --from=frontend /app/dist ./public
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/src/server.js"]
