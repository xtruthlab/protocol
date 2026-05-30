// Correct VotingV2.emissionRate to UMA-aligned monetary policy.
//
// WHY THIS EXISTS
//   The deploy script (deploy/053_deploy_votingV2.js) copied UMA mainnet's
//   emissionRate verbatim — 1.8e17 wei/s ("0.18 UMA/sec, matches UMA
//   mainnet"). That was a units mistake: emissionRate is an ABSOLUTE
//   per-second emission, NOT an APY. It only yields UMA's ~5.7% inflation /
//   ~8.7% staker APY because UMA's genesis supply is ~100,000,000. Our XTR
//   genesis supply is 10,000 — 1/10,000 of UMA's — so the same 1.8e17
//   produces ~126,000% APY and runaway inflation (supply already drifted
//   10,000 → ~10,700 in a few days).
//
// THE FIX
//   Scale UMA's emissionRate by the genesis-supply ratio to preserve the
//   SAME monetary policy (≈5.68% annual inflation of genesis supply):
//
//     emissionRate = 1.8e17 / 10,000 = 1.8e13 wei/s = 0.000018 XTR/s
//
//   Check: 0.000018 × 31,536,000 s/yr = 567.6 XTR/yr ≈ 5.68% of 10,000.
//   At the current ~4,500 staked that's ≈12.6% staker APY — same ballpark
//   as UMA's ~8.7% (ours is a touch higher because a smaller fraction of
//   supply is staked, so the fixed emission concentrates on fewer stakers,
//   exactly as on UMA where ~48% staked → 5.7% inflation became 8.7% APY).
//
//   This is a PERMANENT correction (not a regression-only tweak), but it
//   lives here because it requires VotingV2.owner == deployer EOA, which is
//   the current regression-swap state. Set it now, while the EOA still holds
//   owner; after restore-owner-to-governor.js any further change needs DVM
//   governance.
//
// PRECONDITION: VotingV2.owner == signer EOA (run swap-owner-to-eoa.js first).
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/regression/set-emission-rate-uma-aligned.js --network xlayer

const hre = require("hardhat");
const { ethers, deployments } = hre;

// 1.8e13 wei/s = UMA's 1.8e17 ÷ 10,000 (genesis-supply ratio). Same monetary
// policy: ~5.68% annual inflation of the 10,000 XTR genesis supply.
const TARGET_EMISSION_RATE = ethers.BigNumber.from("18000000000000"); // 1.8e13

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(`Refusing to run on chainId ${chainId}. Mainnet (196) only.`);
  }

  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const votingAddr = (await deployments.get("VotingV2")).address;
  const tokenAddr = (await deployments.get("VotingToken")).address;
  const voting = await ethers.getContractAt("VotingV2", votingAddr, signer);
  const token = await ethers.getContractAt("VotingToken", tokenAddr, signer);

  const owner = await voting.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `VotingV2.owner is ${owner}, not the signer ${signer.address}. ` +
        "Run swap-owner-to-eoa.js first to transfer ownership to the deployer."
    );
  }

  const cur = await voting.emissionRate();
  const supply = await token.totalSupply();
  const cumStake = await voting.cumulativeStake();

  const secPerYear = 31_536_000;
  const fmt = (rate) => {
    const perYear = rate.mul(secPerYear);
    const inflPctOfSupply = supply.gt(0)
      ? perYear.mul(10000).div(supply).toNumber() / 100
      : 0;
    const apy =
      cumStake.gt(0) ? perYear.mul(10000).div(cumStake).toNumber() / 100 : Infinity;
    return {
      perSec: ethers.utils.formatUnits(rate, 18),
      perYear: ethers.utils.formatUnits(perYear, 18),
      inflPctOfSupply,
      apy,
    };
  };

  const before = fmt(cur);
  console.log("\nCurrent emissionRate:");
  console.log("  rate            :", cur.toString(), `(${before.perSec} XTR/s)`);
  console.log("  → per year      :", before.perYear, "XTR");
  console.log("  → supply infl   :", before.inflPctOfSupply + "%");
  console.log("  → staker APY    :", before.apy + "%");
  console.log("  (totalSupply", ethers.utils.formatUnits(supply, 18), "XTR, cumulativeStake", ethers.utils.formatUnits(cumStake, 18), "XTR)");

  if (cur.eq(TARGET_EMISSION_RATE)) {
    console.log("\n✅ emissionRate already at target — nothing to do.");
    return;
  }

  const after = fmt(TARGET_EMISSION_RATE);
  console.log("\nTarget emissionRate (UMA-aligned):");
  console.log("  rate            :", TARGET_EMISSION_RATE.toString(), `(${after.perSec} XTR/s)`);
  console.log("  → per year      :", after.perYear, "XTR");
  console.log("  → supply infl   :", after.inflPctOfSupply + "%");
  console.log("  → staker APY    :", after.apy + "%");

  console.log("\n→ setEmissionRate(" + TARGET_EMISSION_RATE.toString() + ")");
  const tx = await voting.setEmissionRate(TARGET_EMISSION_RATE);
  console.log("  tx:", tx.hash);
  await tx.wait();

  const now = await voting.emissionRate();
  if (!now.eq(TARGET_EMISSION_RATE)) {
    throw new Error(`setEmissionRate appeared to succeed but rate is ${now.toString()}`);
  }
  console.log("\n✅ emissionRate corrected.");
  console.log("⚠ Already-accrued rewards (outstandingRewards) are NOT reset —");
  console.log("  they're an accrued claim, only the GOING-FORWARD rate changes.");
  console.log("  The huge claimable balance from the old rate stays claimable;");
  console.log("  emission from now on accrues at the corrected rate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
