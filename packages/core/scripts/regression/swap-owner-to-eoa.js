// ⚠ REGRESSION-TESTING ONLY — DO NOT RUN IN PRODUCTION ⚠
//
// Transfers VotingV2.owner from GovernorV2 → deployer EOA, so the deployer
// can directly call setGatAndSpat / setMaxRolls / setSlashingLibrary etc.
// without going through DVM voting or the EmergencyProposer 10-day timelock.
//
// HOW IT WORKS
//
//   VotingV2.owner = GovernorV2 (a contract). Only the owner can call
//   setGatAndSpat. To swap, we need GovernorV2 itself to call
//   transferOwnership(newOwner). GovernorV2 has two routes that emit calls:
//
//     A. execute(id) — onlyRoleHolder(Proposer=1), requires DVM resolution.
//        Useless on this chain right now (cumulativeStake=0, GAT=5M XTR,
//        no votes can resolve).
//     B. emergencyExecute(Transaction) — onlyRoleHolder(EmergencyProposer=2),
//        NO timelock inside GovernorV2 itself. The 10-day wait lives in the
//        separate EmergencyProposer contract that currently holds role 2.
//
//   GovernorV2.Roles.Owner (role 0) is managed by itself and manages roles
//   1 & 2 — meaning whoever holds Owner can `resetMember(2, anyAddress)`.
//   We confirmed deployer EOA holds Owner on mainnet.
//
//   So the swap is three transactions, all signed by the deployer:
//     1. GovernorV2.resetMember(2, deployer)
//          → deployer now holds EmergencyProposer role
//     2. GovernorV2.emergencyExecute(VotingV2, 0, transferOwnership(deployer))
//          → VotingV2.owner = deployer  ✅
//     3. GovernorV2.resetMember(2, originalEmergencyProposerContract)
//          → escape hatch closed; EmergencyProposer contract back in role 2
//
// CANONICAL STATE AFTER SWAP — what's "wrong" that must be restored:
//   ⚠ VotingV2.owner = deployer EOA   (canonical: GovernorV2)
//
// Everything else is left untouched. ProposerV2 ownership, EmergencyProposer
// ownership, GovernorV2.Owner, all other Ownable/MultiRole holders — nothing
// in `scripts/regression/ownership-snapshot.json` is mutated except this one
// VotingV2.owner field.
//
// To restore after regression testing: run restore-owner-to-governor.js
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/regression/swap-owner-to-eoa.js --network xlayer

const hre = require("hardhat");
const { ethers, deployments } = hre;

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(
      `Refusing to run on chainId ${chainId}. This regression-only swap script is mainnet-targeted (196). ` +
        "Testnet VotingV2 already has tunable thresholds via the deployer EOA (same owner across the stack)."
    );
  }

  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const govAddr = (await deployments.get("GovernorV2")).address;
  const votingAddr = (await deployments.get("VotingV2")).address;
  const emergencyProposerAddr = (await deployments.get("EmergencyProposer")).address;

  console.log("GovernorV2:        ", govAddr);
  console.log("VotingV2:          ", votingAddr);
  console.log("EmergencyProposer: ", emergencyProposerAddr);

  const gov = await ethers.getContractAt("GovernorV2", govAddr, signer);
  const voting = await ethers.getContractAt("VotingV2", votingAddr, signer);

  // ROLES
  const OWNER_ROLE = 0;
  const EMERGENCY_PROPOSER_ROLE = 2;

  // Pre-flight: deployer must hold GovernorV2.Owner.
  const isOwner = await gov.holdsRole(OWNER_ROLE, signer.address);
  if (!isOwner) {
    throw new Error(
      `Deployer ${signer.address} does NOT hold GovernorV2.Roles.Owner (role 0). ` +
        "Without it the swap is impossible — Owner is the manager of EmergencyProposer."
    );
  }

  // Idempotent short-circuit: if VotingV2 is already owned by the EOA, nothing to do.
  const currentVotingOwner = await voting.owner();
  if (currentVotingOwner.toLowerCase() === signer.address.toLowerCase()) {
    console.log(`\n✅ VotingV2.owner is already ${signer.address} — nothing to do.`);
    console.log("   (If you want to RESTORE, run restore-owner-to-governor.js)");
    return;
  }
  if (currentVotingOwner.toLowerCase() !== govAddr.toLowerCase()) {
    throw new Error(
      `Unexpected VotingV2.owner = ${currentVotingOwner}. Expected GovernorV2 (${govAddr}) or deployer (${signer.address}). ` +
        "Halting — this means ownership has been moved by an unknown actor; investigate before swapping."
    );
  }

  // STEP 1 — take EmergencyProposer role.
  console.log("\n[1/3] GovernorV2.resetMember(EmergencyProposer=2, deployer)");
  let tx = await gov.resetMember(EMERGENCY_PROPOSER_ROLE, signer.address);
  console.log("      tx:", tx.hash);
  await tx.wait();
  console.log("      ✅ deployer now holds EmergencyProposer role");

  // STEP 2 — call VotingV2.transferOwnership(deployer) through GovernorV2.emergencyExecute.
  // GovernorV2._executeCall makes the call FROM GovernorV2, so VotingV2's
  // onlyOwner check passes (owner is GovernorV2 right now).
  const transferData = voting.interface.encodeFunctionData("transferOwnership", [signer.address]);
  console.log("\n[2/3] GovernorV2.emergencyExecute → VotingV2.transferOwnership(deployer)");
  tx = await gov.emergencyExecute({ to: votingAddr, value: 0, data: transferData });
  console.log("      tx:", tx.hash);
  await tx.wait();
  const newVotingOwner = await voting.owner();
  if (newVotingOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`transferOwnership appeared to succeed but VotingV2.owner is still ${newVotingOwner}`);
  }
  console.log("      ✅ VotingV2.owner = deployer");

  // STEP 3 — hand EmergencyProposer role back to the timelock contract.
  // We don't want to leave the escape hatch dangling on an EOA in case the
  // deployer key is ever compromised — restoring closes it.
  console.log("\n[3/3] GovernorV2.resetMember(EmergencyProposer=2, EmergencyProposer-contract)");
  tx = await gov.resetMember(EMERGENCY_PROPOSER_ROLE, emergencyProposerAddr);
  console.log("      tx:", tx.hash);
  await tx.wait();
  const restoredHolder = await gov.getMember(EMERGENCY_PROPOSER_ROLE);
  if (restoredHolder.toLowerCase() !== emergencyProposerAddr.toLowerCase()) {
    throw new Error(`EmergencyProposer role restoration failed — current holder is ${restoredHolder}`);
  }
  console.log("      ✅ EmergencyProposer role restored");

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SWAP COMPLETE.");
  console.log("");
  console.log("VotingV2.owner is now the deployer EOA:");
  console.log("  " + signer.address);
  console.log("");
  console.log("You can now directly call (no governance, no timelock):");
  console.log("  voting.setGatAndSpat(newGat, newSpat)");
  console.log("  voting.setMaxRolls(newMaxRolls)");
  console.log("  voting.setMaxRequestPerRound(newMax)");
  console.log("  voting.setSlashingLibrary(newLib)");
  console.log("  voting.setMigrated(newVotingAddress)   ← careful, breaks the system");
  console.log("");
  console.log("⚠ When regression testing is done, run:");
  console.log("  yarn hardhat run scripts/regression/restore-owner-to-governor.js --network xlayer");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
