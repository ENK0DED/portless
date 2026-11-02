#!/usr/bin/env bash
# Enforce the release-marker rule from AGENTS.md: exactly one changelog entry
# may be wrapped in release markers, because the release workflow extracts the
# GitHub release body from every marked region and would otherwise concatenate
# stale entries.
set -euo pipefail

changelog="${1:-CHANGELOG.md}"

starts=$(grep -c '<!-- release:start -->' "$changelog" || true)
ends=$(grep -c '<!-- release:end -->' "$changelog" || true)

if [ "$starts" -ne 1 ] || [ "$ends" -ne 1 ]; then
  echo "Error: $changelog must contain exactly one release:start and one release:end marker."
  echo "Found $starts release:start and $ends release:end markers."
  echo "Remove the markers from every entry except the release being prepared (see AGENTS.md, Releasing)."
  exit 1
fi

start_line=$(grep -n '<!-- release:start -->' "$changelog" | cut -d: -f1)
end_line=$(grep -n '<!-- release:end -->' "$changelog" | cut -d: -f1)

if [ "$start_line" -ge "$end_line" ]; then
  echo "Error: the release:end marker in $changelog appears before release:start."
  exit 1
fi

echo "Release markers OK: one region, lines $start_line to $end_line."
