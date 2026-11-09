# Multi-arch: linux/amd64 (Mac Intel), linux/arm64 (Mac Silicon)
FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-bookworm

ARG TARGETARCH

# Enable pnpm via corepack (matches package.json packageManager)
RUN corepack enable pnpm \
    && corepack prepare pnpm@10.28.2 --activate

# Keep pnpm store on container disk (not virtiofs workspace mount)
ENV PNPM_STORE_DIR=/home/node/.local/share/pnpm/store
RUN mkdir -p /home/node/.local/share/pnpm/store \
    && chown -R node:node /home/node/.local

# ── Add third-party APT repositories ────────────────────────────────────────
# PostgreSQL 18 client (matches the Postgres sidecar and the OpenShift clusters)
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list

# MongoDB mongosh (Debian repos don't include it; add MongoDB apt repo)
RUN curl -fsSL https://pgp.mongodb.com/server-7.0.asc \
        | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list

# ── Install packages from APT ──────────────────────────────────────────────────
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        postgresql-client-18 \
        mongodb-mongosh \
        jq \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── Playwright runtime deps (Linux) ───────────────────────────────────────────
# Keep this in its own layer so changes elsewhere do not invalidate it.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        libnspr4 \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libdbus-1-3 \
        libcups2 \
        libxkbcommon0 \
        libatspi2.0-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
    && rm -rf /var/lib/apt/lists/*

# ── k6 (load testing) — multi-arch binary download ───────────────────────────
# k6 apt repo lacks arm64 packages, so we download the binary directly.
RUN set -e; \
    case "${TARGETARCH}" in \
        amd64|arm64) ARCH="${TARGETARCH}" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    K6_VERSION="$(curl -fsSL https://api.github.com/repos/grafana/k6/releases/latest | jq -r '.tag_name')"; \
    curl -fsSL "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-${ARCH}.tar.gz" \
        | tar xz --strip-components=1 -C /usr/local/bin

# ── OpenShift CLI (oc) — multi-arch binary download ───────────────────────────
# Supports both Intel and Apple Silicon hosts.
RUN set -e; \
    case "${TARGETARCH}" in \
        amd64) OC_SUFFIX="linux" ;; \
        arm64) OC_SUFFIX="linux-arm64" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    curl -fsSL "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-${OC_SUFFIX}.tar.gz" \
        | tar xz -C /usr/local/bin oc
