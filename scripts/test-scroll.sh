#!/usr/bin/env bash
# test-scroll.sh — Lance les tests de scroll AlphaTab
# Usage : ./scripts/test-scroll.sh [--headed] [--grep <pattern>]
set -e
cd "$(dirname "$0")/.."

echo "=== Tests AlphaTab scroll ==="
npx playwright test tests/tab-scroll.spec.js "$@"
