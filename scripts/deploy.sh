#!/usr/bin/env bash
# Deploys every service to one stage. CI runs this; it also works locally with
# AWS credentials and SERVERLESS_ACCESS_KEY exported.
set -euo pipefail

stage="${1:-}"
case "$stage" in
  dev | prod) ;;
  *)
    echo "usage: $0 <dev|prod>" >&2
    exit 64
    ;;
esac

cd "$(dirname "$0")/.."

for service in services/*/; do
  echo "::group::${service%/} -> $stage"
  (cd "$service" && npx sls deploy --stage "$stage" --conceal)
  echo "::endgroup::"
done
