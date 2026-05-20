// Whitelist bond currencies + set their Store finalFee so OOv3
// assertTruth accepts them (isOnWhitelist + getMinimumBond). OOv3 is
// multi-currency: any whitelisted ERC20 here can be used as a bond.
// X Layer testnet supports WOKB (wrapped native OKB) and a test USDC.
// Idempotent: skips steps already done.
const hre = require("hardhat");
const { ethers, deployments } = hre;

// [address, finalFee] — finalFee in the token's own decimals.
const CURRENCIES = [
  // WOKB — 18 decimals. 0.0001 WOKB minimum bond.
  ["0x4200000000000000000000000000000000000006", ethers.utils.parseUnits("0.0001", 18)],
  // USDC_TEST — 6 decimals. 0.1 USDC minimum bond.
  ["0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d", ethers.utils.parseUnits("0.1", 6)],
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

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
