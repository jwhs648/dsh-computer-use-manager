#!/usr/bin/env bash
# Create an isolated npm project for check-hosts.mjs: the packed manager plus the official host
# and component packages of one DSH version.
# Usage: bash verification/host-project.sh <dsh-version> <project-dir>
set -euo pipefail
version="$1"
project="$2"
repo="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$project"
mkdir -p "$project"
(cd "$repo" && npm pack --pack-destination "$project" --silent >/dev/null)
mv "$project"/local-dsh-computer-use-manager-*.tgz "$project/manager.tgz"
cd "$project"
printf '{"name":"compat-%s","private":true}\n' "$version" > package.json
# --force keeps npm's automatic peer installation (the host packages need cordis and friends),
# unlike --legacy-peer-deps, while tolerating a manager range that does not cover this version:
# check-hosts.mjs is what reports that, with a clear assertion.
npm install --no-audit --no-fund --ignore-scripts --save-exact --force \
  ./manager.tgz \
  "@deepseek-ai/dsh-app-boot@$version" \
  "@deepseek-ai/dsh-plugin-manager@$version" \
  "@deepseek-ai/dsh-atomic-write@$version" \
  "@deepseek-ai/dsh-computer-use@$version" \
  "@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@$version" \
  "@deepseek-ai/dsh-mcp-client@$version"
test -d node_modules/@deepseek-ai/cordis || { echo 'Host peer dependencies were not installed.' >&2; exit 1; }
