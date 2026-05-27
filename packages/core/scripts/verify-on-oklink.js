// Batch-verify every canonical deployment on OKLink (X Layer's block explorer
// run by OKX). After verification, the OKX Wallet signing prompt decodes our
// contract calls — `stake(uint128)`, `assertTruth(bytes,...)` etc — instead
// of showing the dreaded "确认未知交易类型". Sourcify verification (already
// done via `yarn hardhat --network <name> sourcify`) covers the open
// ecosystem but OKX Wallet pulls from OKLink first.
//
// PREREQUISITES
//   1. Mint an OKLink Web3 Open API access key. Go to:
//        https://web3.okx.com/build/dev-portal
//      The portal is wallet-auth (no separate signup):
//        a. Click "Connect wallet" — any EVM wallet works
//        b. Click "Verify address" — sign a message to prove ownership
//        c. Create a project → mint an access key (free tier is fine for
//           contract verification rate limits)
//      Heads-up: OKX moves the portal URL occasionally. If the link 404s,
//      the canonical reference is:
//        https://www.oklink.com/docs/en/#quickstart-guide-getting-started
//      which always points at the current portal.
//   2. Export the key as ETHERSCAN_API_KEY in .env (hardhat-verify reads it
//      via the top-level apiKey, mapped per network in HardhatConfig.ts):
//        # protocol/packages/core/.env
//        ETHERSCAN_API_KEY=<your_oklink_access_key>
//   3. customChains for `xlayer` + `xlayer-testnet` are wired into
//      common/src/HardhatConfig.ts — rebuild @uma/common after pulling so
//      the JS bundle picks up any URL changes:
//        yarn workspace @uma/common build
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/verify-on-oklink.js --network xlayer
//   # or --network xlayer-testnet
//
// What this does
//   - Reads every deployment from packages/core/deployments/<network>/*.json
//   - For each, builds constructor args from the recorded receipt + runs
//     `hardhat verify` programmatically via the verify:verify subtask.
//   - Idempotent: hardhat-verify reports "Already Verified" without erroring
//     so re-running is safe.
//
// Trade-offs / known gotchas
//   - OKLink occasionally rate-limits the verify endpoint. We sleep 3s
//     between contracts to stay below the threshold.
//   - Libraries used by some contracts (e.g. FixedPoint) need to be linked
//     at verify time — hardhat-deploy records the resolved library addresses
//     in the deployment JSON, which we pass through via `libraries`.

const hre = require("hardhat");
const { run } = hre;

// Per-network sleep between contracts — OKLink rate-limits the verify API.
const PER_CONTRACT_DELAY_MS = 3000;

async function main() {
  const { name: networkName } = hre.network;
  if (!["xlayer", "xlayer-testnet"].includes(networkName)) {
    throw new Error(
      `Refusing to run on network '${networkName}'. This script is wired for xlayer / xlayer-testnet only.`
    );
  }

  const all = await hre.deployments.all();
  const names = Object.keys(all).sort();
  console.log(`Verifying ${names.length} deployments on ${networkName} via OKLink…\n`);

  const failed = [];
  const skipped = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const d = all[name];
    const address = d.address;
    // hardhat-deploy stores constructor args under `args`. If absent, treat as
    // no-arg (some libraries / proxies fit this).
    const constructorArguments = d.args ?? [];
    // Resolved library addresses for linking, if any.
    const libraries = d.libraries ?? undefined;

    console.log(`[${i + 1}/${names.length}] ${name} @ ${address}`);
    if (constructorArguments.length > 0) {
      console.log(`   constructor args: ${JSON.stringify(constructorArguments)}`);
    }
    try {
      await run("verify:verify", { address, constructorArguments, ...(libraries ? { libraries } : {}) });
      console.log("   ✅ verified\n");
    } catch (e) {
      const msg = (e && e.message) || String(e);
      // hardhat-verify says "Already Verified" when the contract is already on
      // file — treat that as success.
      if (/already verified/i.test(msg)) {
        console.log("   ✅ already verified\n");
        skipped.push(name);
      } else {
        console.log(`   ❌ FAILED: ${msg.slice(0, 200)}\n`);
        failed.push({ name, address, msg });
      }
    }

    if (i < names.length - 1) {
      await new Promise((r) => setTimeout(r, PER_CONTRACT_DELAY_MS));
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Summary: ${names.length - failed.length} ok, ${failed.length} failed`);
  if (skipped.length) console.log(`  (${skipped.length} were already verified)`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  • ${f.name} @ ${f.address}`);
      console.log(`    ${f.msg.slice(0, 200)}`);
    }
    process.exit(1);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
