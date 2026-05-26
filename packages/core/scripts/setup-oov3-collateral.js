// Whitelist bond currencies + set their Store finalFee so OOv3
// assertTruth accepts them (isOnWhitelist + getMinimumBond). OOv3 is
// multi-currency: any whitelisted ERC20 here can be used as a bond.
// X Layer testnet supports WOKB (wrapped native OKB) and a test USDC.
// Idempotent: skips steps already done.
const hre = require("hardhat");
const { ethers, deployments } = hre;

// Per-chain bond currencies: [address, finalFee] — finalFee in token's own
// decimals. Single source of truth for setup-oov3-collateral + setup-oov3-
// identifier (exported below; the identifier script iterates this same
// table to know which OOv3 currency caches to sync).
//
// MAINNET (196) is stablecoin-only by design: USDC + USDT0 with finalFee 250
// each (aligned with UMA Ethereum mainnet's USDC = 250). WOKB intentionally
// absent — see migrate-mainnet-to-stablecoins.js for the one-off transition
// that removed WOKB from the AddressWhitelist + switched OOv3.defaultCurrency
// to USDC.
const CURRENCIES_BY_CHAIN = {
  1952: [
    // WOKB — 18 decimals. 0.0001 WOKB minimum bond.
    ["0x4200000000000000000000000000000000000006", ethers.utils.parseUnits("0.0001", 18)],
    // USDC_TEST — 6 decimals. 0.1 USDC minimum bond.
    ["0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d", ethers.utils.parseUnits("0.1", 6)],
  ],
  196: [
    // USDC (USDC.e, OKX bridge canonical) — 6 decimals. finalFee 250 USDC.
    ["0x74b7F16337b8972027F6196A17a631aC6dE26d22", ethers.utils.parseUnits("250", 6)],
    // USDT0 (Tether omnichain official) — 6 decimals. finalFee 250 USDT0.
    ["0x779Ded0c9e1022225f8E0630b35a9b54bE713736", ethers.utils.parseUnits("250", 6)],
  ],
};

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const { chainId } = await ethers.provider.getNetwork();
  const CURRENCIES = CURRENCIES_BY_CHAIN[chainId];
  if (!CURRENCIES) {
    throw new Error(
      `No bond-currency table for chainId ${chainId} — add it to CURRENCIES_BY_CHAIN in setup-oov3-collateral.js`
    );
  }
  console.log(`chainId: ${chainId}  (${CURRENCIES.length} currencies to set up)`);

  const awDep = await deployments.get("AddressWhitelist");
  const storeDep = await deployments.get("Store");
  const addressWhitelist = await ethers.getContractAt(awDep.abi, awDep.address, signer);
  const store = await ethers.getContractAt(storeDep.abi, storeDep.address, signer);

  console.log("AddressWhitelist:", addressWhitelist.address);
  console.log("Store:", store.address);

  for (const [currency, finalFee] of CURRENCIES) {
    console.log(`\n— ${currency} —`);
    // 1. Whitelist.
    if (await addressWhitelist.isOnWhitelist(currency)) {
      console.log("  already whitelisted ✓");
    } else {
      const tx = await addressWhitelist.addToWhitelist(currency);
      await tx.wait();
      console.log("  whitelisted:", tx.hash);
    }
    // 2. finalFee.
    const cur = await store.computeFinalFee(currency);
    if (cur.rawValue && cur.rawValue.gt(0)) {
      console.log("  finalFee already set:", cur.rawValue.toString());
    } else {
      const tx = await store.setFinalFee(currency, { rawValue: finalFee });
      await tx.wait();
      console.log("  finalFee set:", finalFee.toString(), tx.hash);
    }
  }

  console.log("\n✓ Bond currencies ready for OOv3 multi-currency assertions");
}

// Export the table so setup-oov3-identifier.js can iterate the same list
// (avoid duplicate addresses drifting between the two scripts).
module.exports = { CURRENCIES_BY_CHAIN };

// Only run if invoked directly (`yarn hardhat run scripts/setup-oov3-collateral.js`),
// not when imported by another script.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
