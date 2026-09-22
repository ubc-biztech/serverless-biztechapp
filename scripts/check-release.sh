#!/usr/bin/env bash
# Refuses to deploy a tag to prod unless it is on master, so prod can only ever
# be an older point on the same history as staging.
set -euo pipefail

tag="${1:-}"
if [ -z "$tag" ]; then
  echo "usage: $0 <tag>" >&2
  exit 64
fi

if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag '$tag' does not exist" >&2
  exit 1
fi

git fetch -q origin master
if ! git merge-base --is-ancestor "$tag" origin/master; then
  echo "Tag '$tag' is not on master; refusing to deploy it to prod" >&2
  exit 1
fi

echo "Tag '$tag' is on master ($(git rev-parse --short "$tag"))"
