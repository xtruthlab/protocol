// Fix two gaps the canonical deploy misses for OOv3 assertions:
//   1. The OOv3 defaultIdentifier (ASSERT_TRUTH) was never added to the
//      IdentifierWhitelist, so assertTruth reverts "Unsupported identifier".
//   2. OOv3 caches per-currency finalFee + per-identifier whitelist status.
//      syncUmaParams pulls the live values into the cache for every bond
//      currency this chain supports.
// Idempotent. Chain-aware: iterates CURRENCIES_BY_CHAIN from
// setup-oov3-collateral.js so the two scripts stay in lockstep.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/setup-oov3-identifier.js --network xlayer       # mainnet
//   yarn hardhat run scripts/setup-oov3-identifier.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;
const { CURRENCIES_BY_CHAIN } = require("./setup-oov3-collateral.js");

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

  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, signer);
  };
  const oov3 = await get("OptimisticOracleV3");
  const idw = await get("IdentifierWhitelist");
  const identifier = await oov3.defaultIdentifier();
  console.log("chainId:", chainId);
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

  // 2. Sync OOv3 cache for every currency in this chain's table.
  console.log(`\nSyncing OOv3 cache for ${CURRENCIES.length} currencies:`);
  for (const [currency] of CURRENCIES) {
    const tx = await oov3.syncUmaParams(identifier, currency);
    await tx.wait();
    const mb = await oov3.getMinimumBond(currency);
    console.log(`  syncUmaParams(${currency}) → getMinimumBond = ${mb.toString()}  (${tx.hash})`);
  }

  console.log("\nVerify:");
  console.log("  isIdentifierSupported:", await idw.isIdentifierSupported(identifier));
  for (const [currency] of CURRENCIES) {
    console.log(`  getMinimumBond(${currency}):`, (await oov3.getMinimumBond(currency)).toString());
  }
  console.log("\n✓ OOv3 ready for assertions");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
