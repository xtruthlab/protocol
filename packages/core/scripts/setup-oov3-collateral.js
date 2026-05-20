// Whitelist WOKB as a bond currency + set its finalFee in Store, so the
// OOv3 deploy (057) passes its isOnWhitelist check and getMinimumBond
// works. X Layer testnet's natural bond currency is WOKB (the Optimism-
// style native-token predeploy). Idempotent: skips steps already done.
const hre = require("hardhat");
const { ethers, deployments } = hre;

const WOKB = "0x4200000000000000000000000000000000000006";
const FINAL_FEE = ethers.utils.parseEther("0.0001"); // minimumBond per assertion

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const awDep = await deployments.get("AddressWhitelist");
  const storeDep = await deployments.get("Store");
  const addressWhitelist = await ethers.getContractAt(awDep.abi, awDep.address, signer);
  const store = await ethers.getContractAt(storeDep.abi, storeDep.address, signer);

  console.log("AddressWhitelist:", addressWhitelist.address);
  console.log("Store:", store.address);

  // 1. Whitelist WOKB.
  const already = await addressWhitelist.isOnWhitelist(WOKB);
  if (already) {
    console.log("WOKB already whitelisted ✓");
  } else {
    console.log("Adding WOKB to AddressWhitelist…");
    const tx = await addressWhitelist.addToWhitelist(WOKB);
    await tx.wait();
    console.log("  whitelisted in", tx.hash);
  }

  // 2. Set finalFee for WOKB.
  const current = await store.computeFinalFee(WOKB);
  if (current.rawValue && current.rawValue.gt(0)) {
    console.log("WOKB finalFee already set:", current.rawValue.toString());
  } else {
    console.log("Setting WOKB finalFee to", FINAL_FEE.toString(), "…");
    const tx = await store.setFinalFee(WOKB, { rawValue: FINAL_FEE });
    await tx.wait();
    console.log("  finalFee set in", tx.hash);
  }

  console.log("\n✓ WOKB ready as OOv3 bond currency");
  console.log("  Deploy OOv3 with: OO_V3_DEFAULT_CURRENCY=" + WOKB);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
