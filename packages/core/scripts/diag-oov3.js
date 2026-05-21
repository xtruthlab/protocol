const hre = require("hardhat");
const { ethers, deployments } = hre;
const WOKB = "0x4200000000000000000000000000000000000006";
const USDC_TEST = "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d";

async function main() {
  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, (await ethers.getSigners())[0]);
  };
  const oov3 = await get("OptimisticOracleV3");
  const idw = await get("IdentifierWhitelist");

  const defId = await oov3.defaultIdentifier();
  console.log("OOv3.defaultIdentifier:", defId, "=", ethers.utils.parseBytes32String(defId));
  const assertTruth = ethers.utils.formatBytes32String("ASSERT_TRUTH");
  console.log("formatBytes32String('ASSERT_TRUTH'):", assertTruth);
  console.log("equal?", defId.toLowerCase() === assertTruth.toLowerCase());

  console.log("\nIdentifierWhitelist.isIdentifierSupported:");
  console.log("  defaultIdentifier:", await idw.isIdentifierSupported(defId));
  console.log("  ASSERT_TRUTH     :", await idw.isIdentifierSupported(assertTruth));

  console.log("\nOOv3 cached currencies (getMinimumBond):");
  console.log("  WOKB     :", (await oov3.getMinimumBond(WOKB)).toString());
  console.log("  USDC_TEST:", (await oov3.getMinimumBond(USDC_TEST)).toString());

  // Check OOv3 has a syncUmaParams-style entrypoint to cache currencies.
  const fns = oov3.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => f.name)
    .filter((n) => /sync|cache|stamp|whitelist|currency|identifier|admin/i.test(n));
  console.log("\nOOv3 relevant functions:", fns.join(", "));

  console.log("\nIdentifierWhitelist owner:", await idw.owner());
  console.log("OOv3 owner:", await oov3.owner());
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
