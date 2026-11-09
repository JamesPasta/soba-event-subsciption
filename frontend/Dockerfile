# syntax=docker.io/docker/dockerfile:1

FROM node:24-alpine AS base

# enable pnpm globally
RUN corepack enable pnpm && corepack prepare pnpm@10.28.2 --activate

# Install dependencies only when needed
FROM base AS deps
# need libc6-compat for some packages on alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app

# copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/package.json frontend/
# lib builds itself on install (prepare), so its source has to be present before pnpm install
COPY lib ./lib

RUN pnpm install --filter ./lib... --frozen-lockfile

# install frontend dependencies through workspace
RUN pnpm install --filter ./frontend... --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=deps /app/lib/node_modules ./lib/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

COPY frontend ./frontend
COPY lib ./lib

# Pre-build the shared library
RUN pnpm --filter @soba/lib run build

# Next.js telemetry note
# ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/frontend
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
# Run build from frontend dir so .next (and .next/standalone) is created here
RUN pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone with outputFileTracingRoot (monorepo) nests server at frontend/server.js
# Standalone does not include .next/static — must copy so /_next/static/* is served
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public

# OpenShift / arbitrary UID: group 0 + g=u so any non-root UID can read/serve static
RUN chgrp -R 0 /app && chmod -R g=u /app
ENV HOME=/tmp
USER 1001

WORKDIR /app/frontend

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
