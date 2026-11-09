FROM node:24-alpine AS builder

# enable pnpm via corepack and ensure workspace installs work
RUN corepack enable pnpm

WORKDIR /app

# copy root workspace config + backend package file
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
# lib builds itself on install (prepare), so its source has to be present before pnpm install
COPY lib ./lib

RUN pnpm install --filter ./lib --frozen-lockfile && pnpm install --filter ./backend... --frozen-lockfile

# copy backend source and build it
COPY backend ./backend
# OpenShift / arbitrary UID: run non-root; g=u lets assigned user (often gid 0) read /app
RUN pnpm --filter ./backend run build && chgrp -R 0 /app && chmod -R g=u /app

FROM node:24-alpine AS runner
WORKDIR /app
# copied out of the builder so /app ships once; the chmod -R there writes a second copy of it
COPY --from=builder /app ./
# COPY keeps the file modes but not the mode of /app itself
RUN chmod g=u /app

# OpenShift: arbitrary UID + read-only root — never invoke pnpm/corepack at runtime (corepack mkdirs under $HOME/.cache; HOME can be unset)
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
USER 1001

EXPOSE 4000

# Run compiled app only (no corepack/pnpm — avoids EACCES on /.cache)
WORKDIR /app
CMD ["node", "backend/dist/src/app.js"]