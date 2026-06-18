---
name: Sportline dev loop
description: How code changes propagate to the running workflows in this pnpm/Turborepo monorepo.
---

# Sportline build / dev loop

Changes do not always hot-reload — some surfaces run *compiled* output.

- **`packages/shared`** is consumed from its built `dist` (`main: ./dist/index.js`), not source. After editing `packages/shared/src/*`, run `pnpm --filter @sportsbooking/shared build` before the api/web typecheck or runtime will see the new types/exports.
- **The "Start Backend" workflow runs `node dist/main.js`** (compiled Nest output), so it does NOT pick up `apps/api/src` edits live. After API changes: `pnpm --filter @sportsbooking/api build`, then restart the `Start Backend` workflow.
- **The "Start application" workflow runs `pnpm dev` (Vite)** for `apps/web` — that one hot-reloads source, no build needed.

**Why:** more than one round of confusion came from editing source and seeing stale behavior because the running process used pre-built artifacts.

**How to apply:** when verifying backend or shared-type changes, rebuild the affected package(s) and restart `Start Backend` first; only the web app reflects edits without a build.
