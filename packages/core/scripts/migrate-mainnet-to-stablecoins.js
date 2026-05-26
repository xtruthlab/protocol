// One-off migration: switch X Layer mainnet (chainId 196) to stablecoin-only
// bond currencies. Does the steps that setup-oov3-collateral.js + setup-oov3-
// identifier.js can't safely do on their own (because they're idempotent
// "add" scripts, not "remove" scripts):
//
//   1. Change OOv3.defaultCurrency from WOKB → USDC via setAdminProperties.
//      (This also auto-syncs the USDC cache, which setup-oov3-identifier.js
//      would do anyway — running it after this script is still safe + a
//      no-op for USDC.)
//   2. Remove WOKB from AddressWhitelist (was the previous default).
//   3. Refresh OOv3's cachedCurrencies[WOKB] so isWhitelisted flips to false
//      in the cache too — otherwise old cache says "yes" and assertTruth
//      with WOKB would still succeed silently.
//
// Pre-requisite: run setup-oov3-collateral.js FIRST so USDC + USDT0 are on
// the AddressWhitelist + Store.finalFee is set for them. setAdminProperties
// requires the new defaultCurrency to be globally whitelisted (otherwise
// the syncUmaParams it calls internally would cache USDC as not-whitelisted,
// breaking assertTruth).
//
// Idempotent across re-runs. Reversible:
//   - To re-add WOKB:  add it back to CURRENCIES_BY_CHAIN[196] in
//     setup-oov3-collateral.js + re-run setup-oov3-collateral + setup-oov3-
//     identifier. (setAdminProperties default doesn't have to flip back.)
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/migrate-mainnet-to-stablecoins.js --network xlayer
const hre = require("hardhat");
const { ethers, deployments } = hre;

const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const WOKB = "0x4200000000000000000000000000000000000006";
const DEFAULT_LIVENESS = 7200; // 2h — keep existing
const BURNED_BOND_PERCENTAGE = ethers.utils.parseUnits("0.5", 18); // 50% — keep existing

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(`This migration is mainnet-only (chainId 196). Connected to ${chainId}.`);
  }
  console.log("signer:", signer.address);
  console.log("chainId:", chainId);

  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, signer);
  };
  const oov3 = await get("OptimisticOracleV3");
  const aw = await get("AddressWhitelist");

  // Pre-flight: USDC must already be on whitelist (setup-oov3-collateral.js
  // should have done that).
  const usdcWhitelisted = await aw.isOnWhitelist(USDC);
  if (!usdcWhitelisted) {
    throw new Error(`USDC (${USDC}) is not on AddressWhitelist — run setup-oov3-collateral.js first.`);
  }
  console.log("USDC pre-check: ✓ on whitelist");

  // 1. Flip OOv3.defaultCurrency from whatever it is now to USDC.
  const currentDefault = await oov3.defaultCurrency();
  if (currentDefault.toLowerCase() === USDC.toLowerCase()) {
    console.log("\n[1] OOv3.defaultCurrency already USDC ✓");
  } else {
    console.log(`\n[1] OOv3.defaultCurrency = ${currentDefault} → USDC`);
    const tx = await oov3.setAdminProperties(USDC, DEFAULT_LIVENESS, BURNED_BOND_PERCENTAGE);
    await tx.wait();
    console.log("    setAdminProperties tx:", tx.hash);
  }

  // 2. Remove WOKB from AddressWhitelist.
  const wokbWhitelisted = await aw.isOnWhitelist(WOKB);
  if (!wokbWhitelisted) {
    console.log("\n[2] WOKB already off whitelist ✓");
  } else {
    console.log("\n[2] Removing WOKB from AddressWhitelist");
    const tx = await aw.removeFromWhitelist(WOKB);
    await tx.wait();
    console.log("    removeFromWhitelist(WOKB) tx:", tx.hash);
  }

  // 3. Re-sync OOv3 cache for WOKB so cached.isWhitelisted flips to false.
  const identifier = await oov3.defaultIdentifier();
  const cachedBefore = await oov3.cachedCurrencies(WOKB);
  if (!cachedBefore.isWhitelisted) {
    console.log("\n[3] OOv3.cachedCurrencies[WOKB].isWhitelisted already false ✓");
  } else {
    console.log("\n[3] Re-syncing OOv3 cache for WOKB (will flip isWhitelisted → false)");
    const tx = await oov3.syncUmaParams(identifier, WOKB);
    await tx.wait();
    console.log("    syncUmaParams(WOKB) tx:", tx.hash);
  }

  console.log("\nFinal state:");
  console.log("  OOv3.defaultCurrency:", await oov3.defaultCurrency());
  console.log("  AddressWhitelist.isOnWhitelist(WOKB):", await aw.isOnWhitelist(WOKB));
  console.log("  AddressWhitelist.isOnWhitelist(USDC):", await aw.isOnWhitelist(USDC));
  const cachedAfter = await oov3.cachedCurrencies(WOKB);
  console.log(`  OOv3.cachedCurrencies[WOKB].isWhitelisted: ${cachedAfter.isWhitelisted}`);
  console.log("  OOv3.getMinimumBond(WOKB):", (await oov3.getMinimumBond(WOKB)).toString());
  console.log("  OOv3.getMinimumBond(USDC):", (await oov3.getMinimumBond(USDC)).toString());
  console.log("\n✓ Mainnet migrated to stablecoin-only bond currencies.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
