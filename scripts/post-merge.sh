#!/bin/bash
set -e

# Post-merge setup for the sportsbooking monorepo.
# Runs from the project root after a task merge. Idempotent + non-interactive.

# 1. Reconcile workspace dependencies.
pnpm install

# 2. Build the shared package (apps/api + apps/web import its compiled dist).
pnpm --filter @sportsbooking/shared build

# 3. Regenerate the Prisma client and apply any committed migrations to the DB.
pnpm --filter @sportsbooking/api run db:generate
pnpm --filter @sportsbooking/api run db:deploy

# 4. Rebuild the API so the "Start Backend" workflow's dist/main.js is current.
pnpm --filter @sportsbooking/api run build
