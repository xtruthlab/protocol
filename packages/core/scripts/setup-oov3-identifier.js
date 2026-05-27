// Post-deploy setup for OOv3 / IdentifierWhitelist / OOv3 cache:
//   1. Add every identifier this app exposes (KNOWN_IDENTIFIERS, mirrored
//      below) to the IdentifierWhitelist. Aligned with UMA Ethereum
//      mainnet's officially-supported structured identifiers — YES_OR_NO_QUERY,
//      NUMERICAL, MULTIPLE_CHOICE_QUERY — plus ASSERT_TRUTH (the OOv3
//      defaultIdentifier, which UMA itself doesn't whitelist but we do
//      because OOv3.assertTruthWithDefaults would otherwise be unusable).
//      Without these, assertTruth reverts "Unsupported identifier".
//   2. OOv3 caches per-currency finalFee + per-identifier whitelist status.
//      syncUmaParams pulls the live values into the cache for every bond
//      currency this chain supports (iterates CURRENCIES_BY_CHAIN from
//      setup-oov3-collateral.js so the two scripts stay in lockstep).
// Idempotent.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/setup-oov3-identifier.js --network xlayer       # mainnet
//   yarn hardhat run scripts/setup-oov3-identifier.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;
const { CURRENCIES_BY_CHAIN } = require("./setup-oov3-collateral.js");

// Identifiers this stack supports. MUST stay in sync with the app's
// KNOWN_IDENTIFIERS list (xtruth-app/src/lib/contracts/identifiers.ts) —
// any identifier the form lets the user pick must also be on chain or
// assertTruth will revert "Unsupported identifier".
//
// Aligned with UMA Ethereum mainnet's IdentifierWhitelist
// (0xcF649d9Da4D1362C4DAEa67573430Bd6f945e570) — UMA officially
// supports YES_OR_NO_QUERY / NUMERICAL / MULTIPLE_CHOICE_QUERY. We add
// ASSERT_TRUTH on top because it's OOv3's defaultIdentifier and the
// "free-text" assertion mode (UMA itself surprisingly doesn't, but every
// dapp that uses OOv3.assertTruthWithDefaults needs it).
const IDENTIFIERS = [
  "ASSERT_TRUTH", // OOv3 default — free-text assertion
  "YES_OR_NO_QUERY", // UMA-aligned — yes/no question
  "NUMERICAL", // UMA-aligned — numeric answer (price, count, …)
  "MULTIPLE_CHOICE_QUERY", // UMA-aligned — multi-choice question
];

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
  const defaultIdentifier = await oov3.defaultIdentifier();
  console.log("chainId:", chainId);
  console.log("OOv3:", oov3.address);
  console.log("defaultIdentifier:", defaultIdentifier, "=", ethers.utils.parseBytes32String(defaultIdentifier));

  // 1. Whitelist every supported identifier (idempotent).
  console.log(`\nAdding ${IDENTIFIERS.length} identifiers to IdentifierWhitelist:`);
  for (const label of IDENTIFIERS) {
    const idBytes32 = ethers.utils.formatBytes32String(label);
    if (await idw.isIdentifierSupported(idBytes32)) {
      console.log(`  ${label}: already supported ✓`);
    } else {
      const tx = await idw.addSupportedIdentifier(idBytes32);
      await tx.wait();
      console.log(`  ${label}: added (${tx.hash})`);
    }
  }

  // 2. Sync OOv3 cache for every currency in this chain's table. The cache
  // key is (identifier, currency) but the finalFee+isWhitelisted values are
  // currency-only — we sync against the defaultIdentifier because that's
  // what OOv3.assertTruthWithDefaults uses; other identifiers cache lazily
  // on first assertion via _validateAndCacheIdentifier.
  console.log(`\nSyncing OOv3 currency cache for ${CURRENCIES.length} currencies:`);
  for (const [currency] of CURRENCIES) {
    const tx = await oov3.syncUmaParams(defaultIdentifier, currency);
    await tx.wait();
    const mb = await oov3.getMinimumBond(currency);
    console.log(`  syncUmaParams(${currency}) → getMinimumBond = ${mb.toString()}  (${tx.hash})`);
  }

  console.log("\nVerify:");
  for (const label of IDENTIFIERS) {
    const ok = await idw.isIdentifierSupported(ethers.utils.formatBytes32String(label));
    console.log(`  isIdentifierSupported(${label}): ${ok}`);
  }
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
