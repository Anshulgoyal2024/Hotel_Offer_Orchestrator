# syntax=docker/dockerfile:1.7
#
# One image, two roles: the same build runs the HTTP API or the Temporal worker
# (compose overrides CMD for the worker).
#
# NOTE: Debian (glibc) base on purpose. Temporal's native core is not supported
# on Alpine/musl.

ARG NODE_VERSION=22

# ---- 1. all dependencies (incl. dev) for compiling ---------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. compile TypeScript ----------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- 3. production-only dependencies -----------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 4. runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Default role = API. The worker is started with:  node dist/worker.js
CMD ["node", "dist/server.js"]
