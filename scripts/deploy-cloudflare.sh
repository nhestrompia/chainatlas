#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-cloudflare.sh [all|api|web|party] [--skip-checks]

Examples:
  ./scripts/deploy-cloudflare.sh all
  ./scripts/deploy-cloudflare.sh api
  ./scripts/deploy-cloudflare.sh web --skip-checks

Notes:
  - Run "npx wrangler login" once before deploying API/Web.
  - Run "npx partykit login" once before deploying PartyKit.
EOF
}

TARGET="all"
RUN_CHECKS=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    all|api|web|party)
      TARGET="$1"
      ;;
    --skip-checks)
      RUN_CHECKS=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

run() {
  echo
  echo "==> $*"
  "$@"
}

deploy_api() {
  echo
  echo "Deploying API (Cloudflare Workers)..."
  if [[ "$RUN_CHECKS" == true ]]; then
    run npm run lint -w @chainatlas/api
  fi
  run npm run deploy -w @chainatlas/api
}

deploy_party() {
  echo
  echo "Deploying PartyKit..."
  if [[ "$RUN_CHECKS" == true ]]; then
    run npm run lint -w @chainatlas/party
  fi
  run npm run deploy -w @chainatlas/party
}

deploy_web() {
  echo
  echo "Deploying Web (Cloudflare Pages)..."
  if [[ "$RUN_CHECKS" == true ]]; then
    run npm run lint -w @chainatlas/web
  fi
  run npm run deploy -w @chainatlas/web
}

case "$TARGET" in
  all)
    deploy_api
    deploy_party
    deploy_web
    ;;
  api)
    deploy_api
    ;;
  web)
    deploy_web
    ;;
  party)
    deploy_party
    ;;
esac

echo
echo "Done: deployed '$TARGET'."
