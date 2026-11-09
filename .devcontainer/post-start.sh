#!/bin/bash
set -e

echo "══════════════════════════════════════════════════════════════"
echo "  SOBA — Dev Container Post-Start"
echo "══════════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Keep active env files in step with their *.example templates: create if missing,
# and on a template change back up the current file before applying the new one.
# shellcheck source=scripts/env-sync.sh
source "$SCRIPT_DIR/scripts/env-sync.sh"
echo "==> Syncing env files with templates..."
sync_env_file backend/.env.example backend/.env backend/.env.hash
sync_env_file backend/.env.local.example backend/.env.local backend/.env.local.hash
sync_env_file frontend/.env.example frontend/.env frontend/.env.hash
sync_env_file integration/playwright/.env.example integration/playwright/.env integration/playwright/.env.hash


# shellcheck source=scripts/pnpm-setup.sh
source "$SCRIPT_DIR/scripts/pnpm-setup.sh"
configure_pnpm
install_workspace_deps ensure

# The install above is skipped unless the lockfile changed, and lib's dist is generated, so build it
# here or a pulled lib change leaves it stale.
echo "==> Building shared lib..."
pnpm --filter @soba/lib run build

echo "══════════════════════════════════════════════════════════════"
