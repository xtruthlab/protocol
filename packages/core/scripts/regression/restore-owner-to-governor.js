// Restore VotingV2.owner back to GovernorV2 after regression testing.
//
// PRECONDITION
//   Deployer EOA currently holds VotingV2.owner (because swap-owner-to-eoa.js
//   ran). If owner is already GovernorV2 this script is a no-op.
//
// SINGLE TRANSACTION
//   VotingV2.transferOwnership(GovernorV2)
//
//   Why this works: after the swap, deployer holds VotingV2.owner and can
//   `transferOwnership` to anywhere. We hand it back to GovernorV2, restoring
//   the canonical governance topology.
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/regression/restore-owner-to-governor.js --network xlayer

const hre = require("hardhat");
const { ethers, deployments } = hre;

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(`Refusing to run on chainId ${chainId}. This script is mainnet-targeted (196).`);
  }

  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const govAddr = (await deployments.get("GovernorV2")).address;
  const votingAddr = (await deployments.get("VotingV2")).address;

  console.log("GovernorV2: ", govAddr);
  console.log("VotingV2:   ", votingAddr);

  const voting = await ethers.getContractAt("VotingV2", votingAddr, signer);

  const currentOwner = await voting.owner();

  if (currentOwner.toLowerCase() === govAddr.toLowerCase()) {
    console.log(`\n✅ VotingV2.owner is already GovernorV2 (${govAddr}) — nothing to do.`);
    return;
  }

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Cannot restore: VotingV2.owner is ${currentOwner}, not the signer ${signer.address}. ` +
        "Only the current owner can transferOwnership. " +
        "Either run this script with the correct key, or transfer ownership to the deployer first."
    );
  }

  console.log("\nVotingV2.transferOwnership(GovernorV2)");
  const tx = await voting.transferOwnership(govAddr);
  console.log("  tx:", tx.hash);
  await tx.wait();

  const after = await voting.owner();
  if (after.toLowerCase() !== govAddr.toLowerCase()) {
    throw new Error(`transferOwnership appeared to succeed but VotingV2.owner is still ${after}`);
  }

  console.log(`\n✅ VotingV2.owner restored to GovernorV2 (${govAddr})`);
  console.log("");
  console.log("Stack ownership topology is back to canonical:");
  console.log("  VotingV2.owner          = GovernorV2");
  console.log("  GovernorV2.Owner        = deployer EOA");
  console.log("  GovernorV2.Proposer     = ProposerV2 contract");
  console.log("  GovernorV2.EmergencyProposer = EmergencyProposer contract (10-day timelock)");
  console.log("");
  console.log("From here, changing VotingV2 params again requires either:");
  console.log("  (a) DVM proposal via ProposerV2 (real governance), or");
  console.log("  (b) emergency path via EmergencyProposer contract (10-day timelock), or");
  console.log("  (c) re-running swap-owner-to-eoa.js for another regression window.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
