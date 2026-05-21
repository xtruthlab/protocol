// Fix two gaps the canonical deploy missed for OOv3 assertions:
//   1. The OOv3 defaultIdentifier (ASSERT_TRUTH) was never added to the
//      IdentifierWhitelist, so assertTruth reverts "Unsupported identifier".
//   2. OOv3 caches per-currency finalFee + per-identifier whitelist status.
//      WOKB was cached with a stale finalFee (0.0002 vs Store's 0.0001) and
//      USDC_TEST was never cached (getMinimumBond == 0). syncUmaParams pulls
//      the live values into the cache.
// Idempotent.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/setup-oov3-identifier.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;

const WOKB = "0x4200000000000000000000000000000000000006";
const USDC_TEST = "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, signer);
  };
  const oov3 = await get("OptimisticOracleV3");
  const idw = await get("IdentifierWhitelist");
  const identifier = await oov3.defaultIdentifier();
  console.log("OOv3:", oov3.address);
  console.log("identifier:", identifier, "=", ethers.utils.parseBytes32String(identifier));

  // 1. Whitelist the identifier.
  if (await idw.isIdentifierSupported(identifier)) {
    console.log("  identifier already supported ✓");
  } else {
    const tx = await idw.addSupportedIdentifier(identifier);
    await tx.wait();
    console.log("  addSupportedIdentifier:", tx.hash);
  }

  // 2. Sync identifier + each currency into the OOv3 cache.
  for (const [name, currency] of [
    ["WOKB", WOKB],
    ["USDC_TEST", USDC_TEST],
  ]) {
    const tx = await oov3.syncUmaParams(identifier, currency);
    await tx.wait();
    const mb = await oov3.getMinimumBond(currency);
    console.log(`  syncUmaParams(${name}) → getMinimumBond = ${mb.toString()}  (${tx.hash})`);
  }

  console.log("\nVerify:");
  console.log("  isIdentifierSupported:", await idw.isIdentifierSupported(identifier));
  console.log("  getMinimumBond(WOKB):", (await oov3.getMinimumBond(WOKB)).toString());
  console.log("  getMinimumBond(USDC_TEST):", (await oov3.getMinimumBond(USDC_TEST)).toString());
  console.log("\n✓ OOv3 ready for assertions");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
