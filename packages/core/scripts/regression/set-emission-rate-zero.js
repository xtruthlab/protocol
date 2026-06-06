// Set VotingV2.emissionRate to ZERO — no staking-reward emission, no XTR
// inflation. Supersedes set-emission-rate-uma-aligned.js (which targeted a
// ~5.68% inflation policy); this is the explicit "0 emission" choice.
//
// WHAT THIS DOES
//   emissionRate = 0 → rewardPerToken stops increasing → stakers accrue NO new
//   rewards going forward. Total XTR supply stops growing (the runaway
//   inflation from the old 0.18 XTR/s rate halts immediately).
//
// SAFE ON ALREADY-EARNED REWARDS
//   setEmissionRate() calls _updateReward(address(0)) first, snapshotting all
//   accrued rewards into rewardPerTokenStored BEFORE the rate changes. So
//   whatever stakers have already earned stays claimable; only future accrual
//   stops.
//
// ⚠ INCENTIVE TRADE-OFF
//   With 0 emission, staking has no positive yield — the only economics left
//   are: earn the loser's bond/slash when you vote correctly (OO disputes),
//   and lose stake (slash) when you vote wrong / don't reveal. There's no
//   carrot for merely participating. If voter turnout matters, plan another
//   incentive (e.g. set a small non-zero rate later, or fee-sharing).
//
// PRECONDITION: VotingV2.owner == signer EOA (swap-owner-to-eoa.js state).
//   After restore-owner-to-governor.js any further change needs DVM governance.
//
// USAGE
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/regression/set-emission-rate-zero.js --network xlayer

const hre = require("hardhat");
const { ethers, deployments } = hre;

const TARGET_EMISSION_RATE = ethers.BigNumber.from("0");

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
  const perYear = cur.mul(secPerYear);
  const infl = supply.gt(0) ? perYear.mul(10000).div(supply).toNumber() / 100 : 0;
  const apy = cumStake.gt(0) ? perYear.mul(10000).div(cumStake).toNumber() / 100 : Infinity;

  console.log("\nCurrent emissionRate:");
  console.log("  rate          :", cur.toString(), `(${ethers.utils.formatUnits(cur, 18)} XTR/s)`);
  console.log("  → per year    :", ethers.utils.formatUnits(perYear, 18), "XTR");
  console.log("  → supply infl :", infl + "%");
  console.log("  → staker APY  :", apy + "%");
  console.log(
    "  (totalSupply",
    ethers.utils.formatUnits(supply, 18),
    "XTR, cumulativeStake",
    ethers.utils.formatUnits(cumStake, 18),
    "XTR)"
  );

  if (cur.eq(TARGET_EMISSION_RATE)) {
    console.log("\n✅ emissionRate already 0 — nothing to do.");
    return;
  }

  console.log("\n→ setEmissionRate(0)  (no emission, no inflation)");
  const tx = await voting.setEmissionRate(TARGET_EMISSION_RATE);
  console.log("  tx:", tx.hash);
  await tx.wait();

  const now = await voting.emissionRate();
  if (!now.eq(TARGET_EMISSION_RATE)) {
    throw new Error(`setEmissionRate appeared to succeed but rate is ${now.toString()}`);
  }
  console.log("\n✅ emissionRate set to 0. Inflation halted; staking yield = 0.");
  console.log("   Already-accrued rewards stay claimable (snapshotted before the change).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
