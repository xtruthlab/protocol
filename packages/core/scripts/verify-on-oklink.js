// Batch-verify every canonical deployment on OKLink (X Layer's block explorer
// run by OKX). After verification, the OKX Wallet signing prompt decodes our
// contract calls — `stake(uint128)`, `assertTruth(bytes,...)` etc — instead
// of showing "确认未知交易类型". Sourcify covers the open ecosystem
// (already done via `yarn hardhat --network <name> sourcify`), but OKX Wallet
// pulls from OKLink, its sibling product.
//
// PREREQUISITES
//   1. Mint an OKLink Web3 Open API access key at:
//        https://web3.okx.com/build/dev-portal
//      Wallet-auth (no separate signup):
//        a. Click "Connect wallet" — any EVM wallet works
//        b. Click "Verify address" — sign a message to prove ownership
//        c. Create a project → mint an access key (free tier is fine for
//           contract verification rate limits)
//      The key is a SINGLE string. This is NOT the same as OKX exchange
//      trading API auth (which uses AK + SK + Passphrase + HMAC). OKLink
//      contract verification uses just one access key, transported by
//      OKX's hardhat plugin internally.
//   2. Export it as OKX_WEB3_API_KEY in .env:
//        # protocol/packages/core/.env
//        OKX_WEB3_API_KEY=<your_oklink_access_key>
//   3. Plugin already wired in packages/core/hardhat.config.js as
//      `okxweb3explorer.apiKey = process.env.OKX_WEB3_API_KEY`. Make sure
//      @uma/common is built so the customChains URLs flow through:
//        yarn workspace @uma/common build
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/verify-on-oklink.js --network xlayer
//   # or --network xlayer-testnet
//
// What this does
//   - Iterates packages/core/deployments/<network>/*.json
//   - For each deployment, runs the `okverify:verify` subtask (OKX
//     plugin's batch entry — matches the README's batchVerify pattern,
//     accepting { address, constructorArguments, libraries }).
//   - Sleeps 3s between contracts to stay under OKLink's verify rate
//     limit.
//   - Tolerates "already verified" responses (re-running is safe).
//
// SINGLE-CONTRACT FALLBACK
//   If the batch script hits an unrecoverable error you can verify one
//   contract at a time with the CLI:
//     yarn hardhat okverify --network xlayer <Address> "<arg1>" "<arg2>" …
//   For a proxy:
//     yarn hardhat okverify --network xlayer --contract <file>:<Name> \
//       --proxy <ProxyAddress>

const hre = require("hardhat");
const { run } = hre;

const PER_CONTRACT_DELAY_MS = 3000;

async function main() {
  const { name: networkName } = hre.network;
  if (!["xlayer", "xlayer-testnet"].includes(networkName)) {
    throw new Error(
      `Refusing to run on network '${networkName}'. This script is wired for xlayer / xlayer-testnet only.`
    );
  }
  if (!process.env.OKX_WEB3_API_KEY) {
    throw new Error(
      "OKX_WEB3_API_KEY is not set. Mint one at https://web3.okx.com/build/dev-portal " +
        "and add it to packages/core/.env before running."
    );
  }

  const all = await hre.deployments.all();
  const names = Object.keys(all).sort();
  console.log(`Verifying ${names.length} deployments on ${networkName} via OKLink (okverify)…\n`);

  const failed = [];
  const skipped = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const d = all[name];
    const address = d.address;
    const constructorArguments = d.args ?? [];
    const libraries = d.libraries ?? undefined;

    console.log(`[${i + 1}/${names.length}] ${name} @ ${address}`);
    if (constructorArguments.length > 0) {
      console.log(`   constructor args: ${JSON.stringify(constructorArguments)}`);
    }
    try {
      // The OKX plugin registers `okverify:verify` as the programmatic
      // batch entry, mirroring hardhat-verify's `verify:verify`. Same
      // shape: { address, constructorArguments, libraries }.
      await run("okverify:verify", {
        address,
        constructorArguments,
        ...(libraries ? { libraries } : {}),
      });
      console.log(`   ✅ verified\n`);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/already verified/i.test(msg)) {
        console.log(`   ✅ already verified\n`);
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
