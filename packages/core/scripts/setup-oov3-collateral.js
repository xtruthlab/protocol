// Whitelist bond currencies + set their Store finalFee so OOv3
// assertTruth accepts them (isOnWhitelist + getMinimumBond). OOv3 is
// multi-currency: any whitelisted ERC20 here can be used as a bond.
// X Layer testnet supports WOKB (wrapped native OKB) and a test USDC.
// Idempotent: skips steps already done.
const hre = require("hardhat");
const { ethers, deployments } = hre;

// Per-chain bond currencies: [address, finalFee] — finalFee in token's own decimals.
// WOKB lives at the SAME OP-stack predeploy address on testnet and mainnet.
// USDC differs per chain (testnet USDC is a custom test token; mainnet USDC TBD —
// add the real X Layer mainnet USDC.e here when you want OOv3 to accept it).
const CURRENCIES_BY_CHAIN = {
  1952: [
    // WOKB — 18 decimals. 0.0001 WOKB minimum bond.
    ["0x4200000000000000000000000000000000000006", ethers.utils.parseUnits("0.0001", 18)],
    // USDC_TEST — 6 decimals. 0.1 USDC minimum bond.
    ["0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d", ethers.utils.parseUnits("0.1", 6)],
  ],
  196: [
    // WOKB only — add mainnet USDC.e here once confirmed.
    ["0x4200000000000000000000000000000000000006", ethers.utils.parseUnits("0.0001", 18)],
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

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
