#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap.
# Node 22 and Yarn 1.22 come from the default image (CI uses cimg/node:22.11).
# Foundry 0.3.0 is the newest attested release that still compiles this repo.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  libudev-dev \
  libusb-1.0-0-dev \
  rsync

if ! command -v node >/dev/null 2>&1 || ! command -v yarn >/dev/null 2>&1; then
  echo "node and yarn must already be on PATH (default image provides Node 22 and Yarn 1.22)" >&2
  exit 1
fi

# .circleci/config.yml pins nightly-70cd140131cd49875c6f31626bdfae08eba35386.
# Current foundryup refuses that tag because it has no Sigstore attestation.
# Foundry 1.8.6 compiles with "stack too deep" against these contracts.
# Attested 0.3.0 (adjacent to that nightly) passes packages/core forge tests.
FOUNDRY_VERSION="0.3.0"

if ! command -v forge >/dev/null 2>&1 || ! forge --version 2>/dev/null | grep -q "forge ${FOUNDRY_VERSION} "; then
  curl -fsSL https://foundry.paradigm.xyz | bash
  "$HOME/.foundry/bin/foundryup" --install "$FOUNDRY_VERSION"
  sudo ln -sf "$HOME/.foundry/bin/forge" /usr/local/bin/forge
  sudo ln -sf "$HOME/.foundry/bin/cast" /usr/local/bin/cast
  sudo ln -sf "$HOME/.foundry/bin/anvil" /usr/local/bin/anvil
  sudo ln -sf "$HOME/.foundry/bin/chisel" /usr/local/bin/chisel
fi

yarn --frozen-lockfile
