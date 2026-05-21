// Grant a dedicated token-admin EOA the XTR Minter + Burner roles so it can
// mint/burn from the xtruth-app admin "Token" panel. Must be run by the XTR
// Owner (the deployer). Idempotent.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   TOKEN_ADMIN=0xYourAdminAddress \
//     yarn hardhat run scripts/setup-token-admin.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;

const MINTER_ROLE = 1;
const BURNER_ROLE = 2;

async function main() {
  const admin = process.env.TOKEN_ADMIN;
  if (!admin || !ethers.utils.isAddress(admin)) {
    throw new Error("Set TOKEN_ADMIN to the token-admin EOA address");
  }
  const [signer] = await ethers.getSigners();
  console.log("signer (must be XTR Owner):", signer.address);
  console.log("token admin to grant:", admin);

  const dep = await deployments.get("VotingToken");
  const xtr = await ethers.getContractAt(dep.abi, dep.address, signer);
  console.log("XTR:", xtr.address);

  const owner = await xtr.getMember(0); // exclusive Owner role
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer is not XTR Owner (owner is ${owner})`);
  }

  for (const [name, role, add] of [
    ["Minter", MINTER_ROLE, "addMinter"],
    ["Burner", BURNER_ROLE, "addBurner"],
  ]) {
    if (await xtr.holdsRole(role, admin)) {
      console.log(`  ${name}: already granted ✓`);
    } else {
      const tx = await xtr[add](admin);
      await tx.wait();
      console.log(`  ${name}: granted (${tx.hash})`);
    }
  }

  console.log("\nVerify:");
  console.log("  Minter:", await xtr.holdsRole(MINTER_ROLE, admin));
  console.log("  Burner:", await xtr.holdsRole(BURNER_ROLE, admin));
  console.log("\n✓ Token admin can now mint + burn XTR from the admin panel");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
