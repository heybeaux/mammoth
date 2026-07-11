#!/usr/bin/env bash
set -euo pipefail

: "${MAMMOTH_PG_PASSWORD:?MAMMOTH_PG_PASSWORD is required; use a private random value of at least 12 characters}"
pnpm --filter @mammoth/production-profile verify:lifecycle
pnpm --filter @mammoth/production-profile verify:backup
