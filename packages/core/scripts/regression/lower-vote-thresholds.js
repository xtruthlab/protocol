// Lower VotingV2 thresholds to regression-test mode.
//
// PRECONDITION: VotingV2.owner = signer EOA. Run swap-owner-to-eoa.js first.
//
// What we tune (all `onlyOwner` on VotingV2 / its Staker base):
//   gat               5,000,000 XTR  →  1 XTR
//                     (governance action threshold — minimum stake-weight to
//                      resolve a request. With cumulativeStake≈0 we need this
//                      tiny so even one staker can finish a vote.)
//   spat              0.5e18 (50%)   →  unchanged (no need to lower)
//   maxRolls          4              →  unchanged
//   unstakeCoolDown   604800 (7d)    →  60s  (so we can stake → vote → unstake → restake fast)
//   emissionRate      1.8e17 / sec   →  unchanged (irrelevant for resolution)
//
// USAGE
//   yarn hardhat run scripts/regression/lower-vote-thresholds.js --network xlayer

const hre = require("hardhat");
const { ethers, deployments } = hre;

// === TUNING TABLE ===
const TARGET_GAT = ethers.utils.parseUnits("1", 18); // 1 XTR
const TARGET_SPAT = ethers.BigNumber.from("500000000000000000"); // 0.5e18 — UNCHANGED, just re-applied
const TARGET_UNSTAKE_COOLDOWN = 60; // seconds

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(`Refusing to run on chainId ${chainId}. Mainnet (196) only.`);
  }

  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const votingAddr = (await deployments.get("VotingV2")).address;
  const tokenAddr = (await deployments.get("VotingToken")).address;
  console.log("VotingV2:    ", votingAddr);
  console.log("VotingToken: ", tokenAddr);

  const voting = await ethers.getContractAt("VotingV2", votingAddr, signer);
  const token = await ethers.getContractAt("VotingToken", tokenAddr, signer);

  const owner = await voting.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `VotingV2.owner is ${owner}, not the signer ${signer.address}. ` +
        "Run swap-owner-to-eoa.js first to transfer ownership to the deployer."
    );
  }

  const totalSupply = await token.totalSupply();
  if (TARGET_GAT.gte(totalSupply)) {
    throw new Error(
      `TARGET_GAT (${TARGET_GAT.toString()}) >= totalSupply (${totalSupply.toString()}). ` +
        "setGatAndSpat requires gat < totalSupply."
    );
  }

  // Read current
  const curGat = await voting.gat();
  const curSpat = await voting.spat();
  const curCd = await voting.unstakeCoolDown();
  console.log("\nBefore:");
  console.log("  gat              :", curGat.toString());
  console.log("  spat             :", curSpat.toString());
  console.log("  unstakeCoolDown  :", curCd.toString());

  // setGatAndSpat
  if (!curGat.eq(TARGET_GAT) || !curSpat.eq(TARGET_SPAT)) {
    console.log(`\n→ setGatAndSpat(${TARGET_GAT.toString()}, ${TARGET_SPAT.toString()})`);
    const tx = await voting.setGatAndSpat(TARGET_GAT, TARGET_SPAT);
    console.log("  tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("\n• gat/spat already at target — skip");
  }

  // setUnstakeCoolDown
  if (!curCd.eq(TARGET_UNSTAKE_COOLDOWN)) {
    console.log(`\n→ setUnstakeCoolDown(${TARGET_UNSTAKE_COOLDOWN})`);
    const tx = await voting.setUnstakeCoolDown(TARGET_UNSTAKE_COOLDOWN);
    console.log("  tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("\n• unstakeCoolDown already at target — skip");
  }

  // Read after
  const aGat = await voting.gat();
  const aSpat = await voting.spat();
  const aCd = await voting.unstakeCoolDown();
  console.log("\nAfter:");
  console.log("  gat              :", aGat.toString(), "(=", ethers.utils.formatUnits(aGat, 18), "XTR)");
  console.log("  spat             :", aSpat.toString());
  console.log("  unstakeCoolDown  :", aCd.toString(), "s");

  console.log("\n✅ Thresholds lowered.");
  console.log("⚠ Remember: these settings are for REGRESSION ONLY.");
  console.log("   Before going live, restore via DVM proposal (raise gat back to a real value,");
  console.log("   raise unstakeCoolDown back to ~604800), then run restore-owner-to-governor.js.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
