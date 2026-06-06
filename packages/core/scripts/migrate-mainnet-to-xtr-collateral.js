// One-off migration: make XTR the ONLY bond/reward collateral on X Layer
// mainnet (chainId 196), removing USDC + USDT0.
//
// Why each step is needed (the AddressWhitelist alone is NOT enough — every
// oracle has its own cache/defaults that must agree):
//
//   1. AddressWhitelist.addToWhitelist(XTR)         — lets OOv2/MOOv2/OOv3 accept
//                                                     XTR as currency at all.
//   2. Store.setFinalFee(XTR, XTR_FINAL_FEE)        — XTR is 18-dec; finalFee is
//                                                     the protocol fee + bond
//                                                     basis. Without it
//                                                     getMinimumBond == 0 (spam).
//   3. OOv3.setAdminProperties(XTR, liveness, burn) — flips OOv3.defaultCurrency
//                                                     USDC→XTR and auto-syncs the
//                                                     XTR cache. MUST run AFTER 1+2
//                                                     (setAdminProperties caches
//                                                     isWhitelisted from the chain
//                                                     state at call time).
//   4. AddressWhitelist.removeFromWhitelist(USDC/USDT0)
//   5. OOv3.syncUmaParams(ASSERT_TRUTH, USDC/USDT0) — flip their OOv3 cache
//                                                     isWhitelisted → false, else
//                                                     the stale cache still says
//                                                     "yes" and assertTruth(USDC)
//                                                     would silently succeed.
//
// MOOv2 note: `allowedBondRanges` are all 0 today, so managers can't set custom
// bonds in ANY currency yet — basic MOOv2 request+propose in XTR works on
// whitelist + finalFee alone (default bond = finalFee). If you later want
// managers to set custom XTR bonds, call MOOv2.setAllowedBondRange(XTR, {min,max})
// from the CONFIG_ADMIN account (separate from this EOA-owned flow).
//
// Idempotent across re-runs. Reversible (see REVERT note at bottom).
//
// Run:
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/migrate-mainnet-to-xtr-collateral.js --network xlayer
const hre = require("hardhat");
const { ethers, deployments } = hre;

// --- addresses (X Layer mainnet 196) ---
const XTR = "0x1819672530c65e1eF3a3f62fA8e6722655225a78"; // VotingToken, 18 dec
const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");

// --- tunables ---------------------------------------------------------------
// XTR is 18-decimal. finalFee is the protocol fee taken on a dispute AND the
// default single-side bond basis. Derived costs at 1000 XTR:
//   OOv3  minBond  = finalFee / burnedBondPercentage = 1000 / 0.5 = 2000 XTR
//   OOv2  proposer = bond(default=finalFee) + finalFee            = 2000 XTR
//   dispute burn   = finalFee + bond/2 = 1000 + 500               = 1500 XTR
const XTR_FINAL_FEE = ethers.utils.parseUnits("1000", 18); // 1000 XTR
// Keep OOv3's existing global knobs when flipping defaultCurrency.
const DEFAULT_LIVENESS = 7200; // 2h (matches current)
const BURNED_BOND_PERCENTAGE = ethers.utils.parseUnits("0.5", 18); // 50% (matches current)
// ---------------------------------------------------------------------------

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) throw new Error(`mainnet-only (196). Connected to ${chainId}.`);
  console.log("signer :", signer.address);
  console.log("chainId:", chainId);

  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, signer);
  };
  const aw = await get("AddressWhitelist");
  const store = await get("Store");
  const oov3 = await get("OptimisticOracleV3");

  // 1. Add XTR to the collateral whitelist.
  if (await aw.isOnWhitelist(XTR)) {
    console.log("\n[1] XTR already on AddressWhitelist ✓");
  } else {
    console.log("\n[1] addToWhitelist(XTR)");
    await (await aw.addToWhitelist(XTR)).wait();
  }

  // 2. Set XTR finalFee in the Store.
  const curFee = (await store.computeFinalFee(XTR)).rawValue;
  if (curFee.eq(XTR_FINAL_FEE)) {
    console.log(`[2] Store.finalFee[XTR] already ${ethers.utils.formatUnits(XTR_FINAL_FEE, 18)} XTR ✓`);
  } else {
    console.log(`[2] Store.setFinalFee(XTR, ${ethers.utils.formatUnits(XTR_FINAL_FEE, 18)} XTR)`);
    await (await store.setFinalFee(XTR, { rawValue: XTR_FINAL_FEE })).wait();
  }

  // 3. Ensure OOv3 default = XTR AND its cached finalFee is current.
  //    setAdminProperties flips the default + syncs as a side-effect; but if
  //    the default is already XTR (re-run after a finalFee change) the cache
  //    can still hold a STALE finalFee — OOv3.getMinimumBond reads the cache,
  //    not the Store live — so we re-sync explicitly when it drifts. (OOv2 /
  //    MOOv2 read Store.computeFinalFee live, so they need no cache refresh.)
  const curDefault = await oov3.defaultCurrency();
  if (curDefault.toLowerCase() !== XTR.toLowerCase()) {
    console.log(`[3] OOv3.setAdminProperties(XTR, ${DEFAULT_LIVENESS}, 0.5) — was ${curDefault}`);
    await (await oov3.setAdminProperties(XTR, DEFAULT_LIVENESS, BURNED_BOND_PERCENTAGE)).wait();
  } else {
    const cached = await oov3.cachedCurrencies(XTR);
    if (cached.finalFee.eq(XTR_FINAL_FEE)) {
      console.log("[3] OOv3.defaultCurrency already XTR, cache fresh ✓");
    } else {
      console.log(`[3] OOv3 XTR cache stale (${cached.finalFee} → ${XTR_FINAL_FEE}); syncUmaParams(XTR)`);
      await (await oov3.syncUmaParams(ASSERT_TRUTH, XTR)).wait();
    }
  }

  // 4. Remove USDC + USDT0 from the whitelist.
  for (const [sym, addr] of [
    ["USDC", USDC],
    ["USDT0", USDT0],
  ]) {
    if (!(await aw.isOnWhitelist(addr))) {
      console.log(`[4] ${sym} already off whitelist ✓`);
    } else {
      console.log(`[4] removeFromWhitelist(${sym})`);
      await (await aw.removeFromWhitelist(addr)).wait();
    }
  }

  // 5. Refresh OOv3 cache for the removed currencies so isWhitelisted → false.
  for (const [sym, addr] of [
    ["USDC", USDC],
    ["USDT0", USDT0],
  ]) {
    const cached = await oov3.cachedCurrencies(addr);
    if (!cached.isWhitelisted) {
      console.log(`[5] OOv3 cache[${sym}].isWhitelisted already false ✓`);
    } else {
      console.log(`[5] syncUmaParams(ASSERT_TRUTH, ${sym})`);
      await (await oov3.syncUmaParams(ASSERT_TRUTH, addr)).wait();
    }
  }

  // --- verify ---------------------------------------------------------------
  console.log("\nFinal state:");
  console.log("  whitelist:", await aw.getWhitelist());
  console.log("  OOv3.defaultCurrency:", await oov3.defaultCurrency());
  for (const [sym, addr] of [
    ["XTR", XTR],
    ["USDC", USDC],
    ["USDT0", USDT0],
  ]) {
    const wl = await aw.isOnWhitelist(addr);
    const ff = (await store.computeFinalFee(addr)).rawValue.toString();
    const mb = (await oov3.getMinimumBond(addr)).toString();
    console.log(`  ${sym}: onWhitelist=${wl} finalFee=${ff} OOv3.getMinimumBond=${mb}`);
  }
  console.log("\n✓ XTR is now the sole bond/reward collateral.");
  // REVERT: re-add USDC/USDT0 (addToWhitelist + setFinalFee), then
  //   oov3.setAdminProperties(USDC, 7200, 0.5e18) to restore the default, then
  //   removeFromWhitelist(XTR) + syncUmaParams(ASSERT_TRUTH, XTR).
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
