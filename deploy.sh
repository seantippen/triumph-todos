#!/usr/bin/env bash
# Deploy triumph-todos to Cloudflare Pages.
# CF project production branch is "master" (not main), so we target master.
set -euo pipefail
cd "$(dirname "$0")"
npx wrangler pages deploy web --project-name=todo --branch=master "$@"
