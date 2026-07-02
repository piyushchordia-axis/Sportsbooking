#!/bin/bash
set -e

# Post-merge setup for the sportsbooking monorepo.
# Runs from the project root after a task merge. Idempotent + non-interactive.

# 1. Reconcile workspace dependencies.
pnpm install

# 2. Build the shared package (apps/api + apps/web import its compiled dist).
pnpm --filter @sportsbooking/shared build

# 3. Rebuild the API so the "Start Backend" workflow's dist/main.js is current.
pnpm --filter @sportsbooking/api run build

# NOTE: schema changes are NOT applied here. The project uses Drizzle (not
# Prisma); migrations are applied explicitly on deploy via `db:migrate`
# (deploy/deploy.sh), never automatically on a merge — auto-migrating a shared/
# prod DB on every merge is unsafe. Run `pnpm --filter @sportsbooking/api db:push`
# locally for a dev DB.
