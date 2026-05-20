// Deploy the XtrFaucet (testnet XTR faucet) and grant it the VotingToken
// Minter role so drip() can mint. Idempotent on the addMinter step.
//
// Run:
//   set -a; source ../../.env; set +a; export PRIVATE_KEY="0x$PRIVATE_KEY"
//   yarn hardhat run scripts/deploy-xtr-faucet.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;

// Faucet params.
const DRIP_AMOUNT = ethers.utils.parseUnits("1000", 18); // 1000 XTR per drip
const COOLDOWN = 3600; // 1 hour between drips per address

// VotingToken (XTR) MultiRole: Owner = 0, Minter = 1.
const MINTER_ROLE = 1;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const tokenDep = await deployments.get("VotingToken");
  const token = await ethers.getContractAt(tokenDep.abi, tokenDep.address, signer);
  console.log("VotingToken (XTR):", token.address);

  // 1. Deploy the faucet.
  const Faucet = await ethers.getContractFactory("XtrFaucet", signer);
  const faucet = await Faucet.deploy(token.address, DRIP_AMOUNT, COOLDOWN);
  await faucet.deployed();
  console.log("XtrFaucet deployed:", faucet.address);
  console.log("  dripAmount:", DRIP_AMOUNT.toString(), "(1000 XTR)");
  console.log("  cooldown:", COOLDOWN, "s");

  // 2. Grant Minter role to the faucet (idempotent).
  const already = await token.holdsRole(MINTER_ROLE, faucet.address);
  if (already) {
    console.log("  faucet already holds Minter role ✓");
  } else {
    const tx = await token.addMinter(faucet.address);
    await tx.wait();
    console.log("  addMinter:", tx.hash);
  }

  // 3. Sanity: confirm role is set.
  const ok = await token.holdsRole(MINTER_ROLE, faucet.address);
  console.log(ok ? "\n✓ Faucet is a Minter — drip() will work" : "\n✗ Minter role NOT set");
  console.log("\nXtrFaucet address →", faucet.address);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
