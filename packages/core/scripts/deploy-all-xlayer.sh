#!/usr/bin/env bash
# One-command X Layer deploy: builds, deploys the full canonical UMA stack,
# runs all post-deploy setup, and propagates the resulting addresses into the
# frontend (xtruth-app) + subgraphs via sync-deployed-addresses.js.
#
# Usage:
#   # Testnet (chainId 1952) — includes MockOracle + faucet-friendly setup:
#   ./scripts/deploy-all-xlayer.sh xlayer-testnet
#
#   # Mainnet (chainId 196) — no MockOracle, real DVM is the oracle:
#   ./scripts/deploy-all-xlayer.sh xlayer-mainnet
#
# MOOv2 lives in the SEPARATE managed-oracle repo (forge-deployed). Deploy it
# there first, then pass its address/block so this script registers + whitelists
# it and writes it into the app/subgraphs:
#   MOOV2_ADDRESS=0x.. MOOV2_BLOCK=12345 MOOV2_WHITELIST=0x.. \
#     ./scripts/deploy-all-xlayer.sh xlayer-mainnet
#
# Env (from packages/core/.env, auto-sourced): PRIVATE_KEY (or MNEMONIC),
# NODE_URL_<chainId>. Optional: SKIP_BUILD=1, SKIP_SYNC=1, ETHERSCAN_API_KEY.
set -euo pipefail

NETWORK="${1:-xlayer-mainnet}"
cd "$(dirname "$0")/.."   # packages/core

# network -> chainId + subgraph network name + testnet flag
case "$NETWORK" in
  xlayer-testnet) CHAIN_ID=1952; SGNET=xlayer-testnet; TESTNET=1 ;;
  xlayer-mainnet) CHAIN_ID=196;  SGNET=xlayer-mainnet; TESTNET=0 ;;
  *) echo "✗ unknown network '$NETWORK' (expected xlayer-testnet|xlayer-mainnet)"; exit 1 ;;
esac

echo "════════════════════════════════════════════════════════════"
echo " Deploy canonical UMA stack → $NETWORK  (chainId $CHAIN_ID)"
echo "════════════════════════════════════════════════════════════"

# Load deployer creds + RPC. PRIVATE_KEY in .env is 64 hex without 0x.
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
if [ -n "${PRIVATE_KEY:-}" ]; then export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"; fi
export NODE_OPTIONS="--max-old-space-size=8192"

# Indirect-expand NODE_URL_<chainId> to check the RPC is configured.
RPC_VAR="NODE_URL_${CHAIN_ID}"
if [ -z "${!RPC_VAR:-}" ]; then
  echo "⚠ ${RPC_VAR} not set — hardhat may fail to connect to $NETWORK"
fi

run() { echo; echo "▶ $*"; "$@"; }

# 1. Build (common + core compile). Skip with SKIP_BUILD=1 if already built.
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  run yarn --cwd ../.. workspace @uma/common build
  run yarn hardhat compile
fi

# 2. Core DVM + OOv1/v2/Skinny suite. MockOracle only on testnet.
if [ "$TESTNET" = "1" ]; then
  run yarn hardhat deploy --network "$NETWORK" --tags dvmv2,MockOracle
  run yarn hardhat setup-dvmv2-testnet --network "$NETWORK" --mockoracle
else
  run yarn hardhat deploy --network "$NETWORK" --tags dvmv2
  run yarn hardhat setup-dvmv2-testnet --network "$NETWORK"
fi

# 3. OOv3 (separate tag) + re-run setup to register it in Finder/Registry.
run yarn hardhat deploy --network "$NETWORK" --tags OptimisticOracleV3
if [ "$TESTNET" = "1" ]; then
  run yarn hardhat setup-dvmv2-testnet --network "$NETWORK" --mockoracle
else
  run yarn hardhat setup-dvmv2-testnet --network "$NETWORK"
fi

# 4. OOv3 needs the ASSERT_TRUTH identifier whitelisted + currencies synced,
#    and bond collateral whitelisted with Store finalFee.
run yarn hardhat run scripts/setup-oov3-collateral.js --network "$NETWORK"
run yarn hardhat run scripts/setup-oov3-identifier.js --network "$NETWORK"

# 5. MOOv2 (deployed separately in the managed-oracle repo). If its address is
#    provided, register it in the DVM Registry + seed the proposer/requester
#    whitelist so disputes can escalate and authorized parties can use it.
if [ -n "${MOOV2_ADDRESS:-}" ]; then
  run yarn hardhat run scripts/register-moov2-dvm.js --network "$NETWORK"
  run yarn hardhat run scripts/setup-moov2-whitelist.js --network "$NETWORK"
else
  echo
  echo "ℹ MOOV2_ADDRESS not set — skipping MOOv2 register/whitelist."
  echo "  Deploy MOOv2 in the managed-oracle repo, then re-run with"
  echo "  MOOV2_ADDRESS=0x.. MOOV2_BLOCK=.. MOOV2_WHITELIST=0x.. (or run those"
  echo "  two scripts manually) and sync again."
fi

# 6. Propagate addresses → xtruth-app CONTRACTS[$CHAIN_ID] + subgraphs data files.
if [ "${SKIP_SYNC:-0}" != "1" ]; then
  FORCE=""
  [ "$TESTNET" = "1" ] && FORCE="--force"  # testnet block is hand-maintained; require explicit force
  run node scripts/sync-deployed-addresses.js \
    --network "$NETWORK" --chain-id "$CHAIN_ID" --subgraph-network "$SGNET" $FORCE
fi

echo
echo "════════════════════════════════════════════════════════════"
echo " ✓ Done. Deployed to $NETWORK and wrote addresses into:"
echo "    • xtruth-app/src/lib/contracts/addresses.ts  (CONTRACTS[$CHAIN_ID])"
echo "    • subgraphs/packages/*/manifest/data/$SGNET.json"
echo
echo " Next:"
echo "   1. Review the address diffs (git diff in xtruth-app + subgraphs)."
echo "   2. Deploy subgraphs:  cd subgraphs/packages/<pkg> &&"
echo "        yarn prepare:$SGNET && yarn codegen && yarn build && DOCKER=true yarn deploy:$SGNET"
echo "   3. Build the app with NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID (main→196, dev→1952)."
[ -z "${MOOV2_ADDRESS:-}" ] && echo "   4. Deploy MOOv2 (managed-oracle repo) and re-sync — see note above."
echo "════════════════════════════════════════════════════════════"
