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
# Repo layout: by DEFAULT this expects the other repos to be SIBLINGS of the
# protocol repo (the dev setup):
#   <parent>/protocol  <parent>/xtruth-app  <parent>/subgraphs  <parent>/managed-oracle
# A different clone layout? Point at each repo root explicitly via env:
#   XTRUTH_APP_DIR=/abs/xtruth-app  SUBGRAPHS_DIR=/abs/subgraphs  \
#   MANAGED_ORACLE_DIR=/abs/managed-oracle  ./scripts/deploy-all-xlayer.sh xlayer-mainnet
# Repos that aren't present are skipped with a warning (deploy still succeeds) —
# so this works even if you only cloned protocol.
#
# Env (from packages/core/.env, auto-sourced): PRIVATE_KEY (or MNEMONIC),
# NODE_URL_<chainId>. Optional: SKIP_BUILD=1, SKIP_SYNC=1, DEPLOY_MOOV2=1,
# XTRUTH_APP_DIR, SUBGRAPHS_DIR, MANAGED_ORACLE_DIR, ETHERSCAN_API_KEY.
set -euo pipefail

NETWORK="${1:-xlayer-mainnet}"
cd "$(dirname "$0")/.."   # packages/core

# Map the CLI selector → hardhat network name (HARDHAT_NET, also the
# deployments/<net> dir), chainId, subgraph network name, testnet flag.
# NOTE the asymmetry: hardhat's mainnet network is named "xlayer" (not
# "xlayer-mainnet"), while the SUBGRAPH network is "xlayer-mainnet".
case "$NETWORK" in
  xlayer-testnet)        HARDHAT_NET=xlayer-testnet; CHAIN_ID=1952; SGNET=xlayer-testnet; TESTNET=1 ;;
  xlayer-mainnet|xlayer) HARDHAT_NET=xlayer;         CHAIN_ID=196;  SGNET=xlayer-mainnet; TESTNET=0 ;;
  *) echo "✗ unknown network '$NETWORK' (expected xlayer-testnet | xlayer-mainnet)"; exit 1 ;;
esac

echo "════════════════════════════════════════════════════════════"
echo " Deploy canonical UMA stack → $NETWORK  (chainId $CHAIN_ID)"
echo "════════════════════════════════════════════════════════════"

# Load deployer creds + RPC. Anything the user explicitly exported BEFORE
# invoking this script takes precedence over .env — sourcing .env normally
# clobbers the live env, which silently brings back the testnet key when
# you `export PRIVATE_KEY=newkey` for a mainnet deploy. Save the user's
# values, source .env, then restore the saved ones if they were set.
SAVED_PK="${PRIVATE_KEY:-}"
SAVED_MN="${MNEMONIC:-}"
SAVED_RPC_VAR="NODE_URL_${CHAIN_ID}"; SAVED_RPC="${!SAVED_RPC_VAR:-}"
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
[ -n "$SAVED_PK"  ] && export PRIVATE_KEY="$SAVED_PK"
[ -n "$SAVED_MN"  ] && export MNEMONIC="$SAVED_MN"
[ -n "$SAVED_RPC" ] && export "$SAVED_RPC_VAR=$SAVED_RPC"
if [ -n "${PRIVATE_KEY:-}" ]; then export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"; fi
export NODE_OPTIONS="--max-old-space-size=8192"

# Print the deployer address + balance up front so a wrong-key / unfunded
# wallet is caught BEFORE 70 deploy txs get queued. Best-effort: skips if
# ethers isn't importable from cwd (we're in packages/core so it should be).
DEPLOYER=$(node -e 'try{const {Wallet}=require("ethers");const k=process.env.PRIVATE_KEY||"";if(!k){process.exit(0)};console.log(new Wallet(k.startsWith("0x")?k:"0x"+k).address)}catch{}' 2>/dev/null)
if [ -n "$DEPLOYER" ]; then
  echo "  deployer: $DEPLOYER"
  BAL=$(curl -s -X POST -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER\",\"latest\"]}" \
    "${!SAVED_RPC_VAR}" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s);if(r.result)console.log((Number(BigInt(r.result))/1e18).toFixed(6));}catch{}})')
  if [ -n "$BAL" ]; then echo "  balance:  $BAL OKB"; fi
fi

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
  run yarn hardhat deploy --network "$HARDHAT_NET" --tags dvmv2,MockOracle
  run yarn hardhat setup-dvmv2 --network "$HARDHAT_NET" --mockoracle
else
  run yarn hardhat deploy --network "$HARDHAT_NET" --tags dvmv2
  run yarn hardhat setup-dvmv2 --network "$HARDHAT_NET"
fi

# 3. Bond collateral MUST be whitelisted in AddressWhitelist BEFORE OOv3
#    deploys — 057_deploy_optimistic_oracle_V3.js refuses to deploy unless
#    its default currency is on the whitelist. So this runs first.
run yarn hardhat run scripts/setup-oov3-collateral.js --network "$HARDHAT_NET"

# 4. OOv3 deploy. The deploy script needs OO_V3_DEFAULT_CURRENCY for chains
#    not in its built-in ADDRESSES_FOR_NETWORK table (xlayer-testnet 1952
#    and xlayer-mainnet 196 both qualify). Default to WOKB (OP-stack
#    predeploy, same address on both chains) unless the user set it.
export OO_V3_DEFAULT_CURRENCY="${OO_V3_DEFAULT_CURRENCY:-0x4200000000000000000000000000000000000006}"
run yarn hardhat deploy --network "$HARDHAT_NET" --tags OptimisticOracleV3
# Re-run setup to register the new OOv3 in Finder/Registry.
if [ "$TESTNET" = "1" ]; then
  run yarn hardhat setup-dvmv2 --network "$HARDHAT_NET" --mockoracle
else
  run yarn hardhat setup-dvmv2 --network "$HARDHAT_NET"
fi

# 5. ASSERT_TRUTH identifier + sync OOv3's cached params for each currency.
run yarn hardhat run scripts/setup-oov3-identifier.js --network "$HARDHAT_NET"

# 6. MOOv2 lives in the SEPARATE managed-oracle repo (Foundry). Four ways in:
#   (a) DEPLOY_MOOV2=1 → forge-deploys whitelist + MOOv2 proxy here (FINDER
#       pulled from the protocol deploy), captures addr/block from the
#       broadcast, and continues.
#   (b) DEPLOY_MOOV2=1 AND a previous broadcast/run-latest.json exists for
#       this chainId → REUSE that MOOv2 (mirrors hardhat-deploy's
#       "reusing X at Y" semantics so you can safely re-run the wrapper
#       without deploying a fresh proxy each time). Override with
#       FORCE_REDEPLOY_MOOV2=1 if you really want a new one.
#   (c) MOOV2_ADDRESS=0x.. already set → just register + whitelist + sync it.
#   (d) neither → skip; deploy MOOv2 yourself later and re-run with MOOV2_ADDRESS.
if [ "${DEPLOY_MOOV2:-0}" = "1" ] && [ -z "${MOOV2_ADDRESS:-}" ]; then
  MO_DIR="${MANAGED_ORACLE_DIR:-$(cd ../../../managed-oracle 2>/dev/null && pwd || true)}"
  if [ -z "$MO_DIR" ] || [ ! -d "$MO_DIR" ]; then
    echo "✗ DEPLOY_MOOV2=1 but managed-oracle repo not found (set MANAGED_ORACLE_DIR)"; exit 1
  fi
  eval "RPC=\${NODE_URL_${CHAIN_ID}}"
  MOOV2_BC="$MO_DIR/broadcast/DeployManagedOptimisticOracleV2.s.sol/${CHAIN_ID}/run-latest.json"
  WL_BC="$MO_DIR/broadcast/DeployAddressWhitelist.s.sol/${CHAIN_ID}/run-latest.json"

  # (b) Reuse-from-broadcast: if a previous MOOv2 deploy on THIS chain exists
  # AND the proxy address still has bytecode, skip the forge step.
  if [ -f "$MOOV2_BC" ] && [ "${FORCE_REDEPLOY_MOOV2:-0}" != "1" ]; then
    PREV_PROXY=$(node -e "try{const t=require('$MOOV2_BC').transactions.find(x=>x.contractName==='ERC1967Proxy');console.log(t?t.contractAddress:'')}catch{}")
    if [ -n "$PREV_PROXY" ]; then
      HAS_CODE=$(curl -s -X POST -H 'content-type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$PREV_PROXY\",\"latest\"]}" \
        "$RPC" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s);console.log(r.result&&r.result!=="0x"?"yes":"no")}catch{console.log("no")}})')
      if [ "$HAS_CODE" = "yes" ]; then
        echo; echo "▶ reusing MOOv2 proxy at $PREV_PROXY"
        echo "  (from $MOOV2_BC — set FORCE_REDEPLOY_MOOV2=1 to ignore and deploy a fresh proxy)"
        export MOOV2_ADDRESS="$PREV_PROXY"
        export MOOV2_BLOCK=$(node -e "const d=require('$MOOV2_BC');const p=d.transactions.find(x=>x.contractName==='ERC1967Proxy');const r=(d.receipts||[]).find(x=>x.contractAddress&&x.contractAddress.toLowerCase()===p.contractAddress.toLowerCase());console.log(r?parseInt(r.blockNumber,16):0)")
        if [ -f "$WL_BC" ]; then
          export MOOV2_WHITELIST=$(node -e "try{const t=require('$WL_BC').transactions.find(x=>x.contractName==='AddressWhitelist');console.log(t?t.contractAddress:'')}catch{}")
        fi
        echo "  proxy=$MOOV2_ADDRESS  block=$MOOV2_BLOCK  whitelist=${MOOV2_WHITELIST:-<not found in broadcast>}"
      fi
    fi
  fi

  # (a) First-time forge deploy if we didn't recover a reusable MOOv2.
  if [ -z "${MOOV2_ADDRESS:-}" ]; then
    FINDER=$(node -e "console.log(require('./deployments/${HARDHAT_NET}/Finder.json').address)")

    # Same reuse-from-broadcast guard for the AddressWhitelist: if it was
    # already deployed (typically because a previous wrapper run got past
    # the whitelist step but failed on MOOv2), reuse that address instead
    # of forge-deploying a second one. FORCE_REDEPLOY_MOOV2=1 also forces
    # a fresh whitelist (they're paired — a new MOOv2 wants its own).
    WL=""
    if [ -f "$WL_BC" ] && [ "${FORCE_REDEPLOY_MOOV2:-0}" != "1" ]; then
      PREV_WL=$(node -e "try{const t=require('$WL_BC').transactions.find(x=>x.contractName==='AddressWhitelist');console.log(t?t.contractAddress:'')}catch{}")
      if [ -n "$PREV_WL" ]; then
        WL_HAS_CODE=$(curl -s -X POST -H 'content-type: application/json' \
          -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$PREV_WL\",\"latest\"]}" \
          "$RPC" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s);console.log(r.result&&r.result!=="0x"?"yes":"no")}catch{console.log("no")}})')
        if [ "$WL_HAS_CODE" = "yes" ]; then
          WL="$PREV_WL"
          echo; echo "▶ reusing AddressWhitelist at $WL (from $WL_BC)"
        fi
      fi
    fi

    echo; echo "▶ forge-deploying MOOv2 in $MO_DIR  (Finder=$FINDER)"
    ( cd "$MO_DIR"
      # Ensure a fresh, full Foundry build. OZ upgrades-core's safety
      # validator (invoked by DeployManagedOptimisticOracleV2.s.sol) rejects
      # partial build-info — symptom: "Build info file ... is not from a
      # full compilation". A stale out/build-info/ from an older partial
      # compile triggers this; `forge clean` wipes it and forge build
      # regenerates with extra_output=storageLayout (already in foundry.toml).
      forge clean >/dev/null && forge build >/dev/null
      if [ -z "$WL" ]; then
        forge script script/DeployAddressWhitelist.s.sol --rpc-url "$RPC" --broadcast \
          --private-key "$PRIVATE_KEY" >/dev/null
        WL=$(node -e "const t=require('$WL_BC').transactions.find(x=>x.contractName==='AddressWhitelist');console.log(t.contractAddress)")
      fi
      FINDER_ADDRESS="$FINDER" DEFAULT_PROPOSER_WHITELIST="$WL" REQUESTER_WHITELIST="$WL" \
        forge script script/DeployManagedOptimisticOracleV2.s.sol --rpc-url "$RPC" --broadcast \
        --private-key "$PRIVATE_KEY" >/dev/null
      node -e "const d=require('$MOOV2_BC');const p=d.transactions.find(x=>x.contractName==='ERC1967Proxy');const r=(d.receipts||[]).find(x=>x.contractAddress&&x.contractAddress.toLowerCase()===p.contractAddress.toLowerCase());require('fs').writeFileSync('/tmp/moov2-deploy.env','MOOV2_ADDRESS='+p.contractAddress+'\nMOOV2_BLOCK='+(r?parseInt(r.blockNumber,16):0)+'\nMOOV2_WHITELIST=$WL\n')"
    )
    set -a; . /tmp/moov2-deploy.env; set +a; rm -f /tmp/moov2-deploy.env
    echo "  ✓ MOOv2 proxy=$MOOV2_ADDRESS  block=$MOOV2_BLOCK  whitelist=$MOOV2_WHITELIST"
  fi
fi

if [ -n "${MOOV2_ADDRESS:-}" ]; then
  run yarn hardhat run scripts/register-moov2-dvm.js --network "$HARDHAT_NET"
  run yarn hardhat run scripts/setup-moov2-whitelist.js --network "$HARDHAT_NET"
else
  echo
  echo "ℹ MOOV2_ADDRESS not set (and DEPLOY_MOOV2!=1) — skipping MOOv2."
  echo "  Either re-run with DEPLOY_MOOV2=1 (forge-deploys MOOv2 here), or deploy"
  echo "  MOOv2 in the managed-oracle repo and re-run with MOOV2_ADDRESS=0x.."
fi

# 7. Propagate addresses → xtruth-app CONTRACTS[$CHAIN_ID] + subgraphs data files.
if [ "${SKIP_SYNC:-0}" != "1" ]; then
  FORCE=""
  [ "$TESTNET" = "1" ] && FORCE="--force"  # testnet block is hand-maintained; require explicit force
  run node scripts/sync-deployed-addresses.js \
    --network "$HARDHAT_NET" --chain-id "$CHAIN_ID" --subgraph-network "$SGNET" $FORCE
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
