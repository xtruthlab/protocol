// One-off: whitelist a test account on MOOv2 + mint it XTR (X Layer mainnet 196).
//
//   1. AddressWhitelist(0xDEEa77AC…).addToWhitelist(TARGET)
//      NB: on mainnet MOOv2.requesterWhitelist == defaultProposerWhitelist ==
//      this SAME contract, so one add grants the account BOTH the requester
//      and proposer roles (it can create requests AND propose).
//   2. VotingToken(XTR).mint(TARGET, MINT_AMOUNT)  — bond/reward currency.
//
// Both calls come from the deployer EOA, which owns the whitelist (owner())
// and holds the XTR Minter role (verified on-chain).
//
// Idempotent: skips the whitelist add if already present, and skips the mint
// if TARGET already holds >= MINT_AMOUNT (so a re-run won't double-mint).
//
// Run:
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/setup-test-account-mainnet.js --network xlayer
const hre = require("hardhat");
const { ethers, deployments } = hre;

const TARGET = "0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A";
// MOOv2 requester+proposer whitelist (same contract). NOT a hardhat-deploy
// artifact — it was deployed via the managed-oracle foundry scripts — so it's
// hardcoded here rather than read from deployments.
const MOOV2_WHITELIST = "0xDEEa77AC6c2356Df9A6f57802EB68b4B2C5C1AAC";
const MINT_AMOUNT = ethers.utils.parseUnits("10000", 18); // 10,000 XTR (18 dec)

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) throw new Error(`mainnet-only (196). Connected to ${chainId}.`);
  console.log("signer :", signer.address);
  console.log("target :", TARGET);

  const wl = await ethers.getContractAt(
    [
      "function addToWhitelist(address) external",
      "function isOnWhitelist(address) view returns (bool)",
      "function owner() view returns (address)",
      "function getWhitelist() view returns (address[])",
    ],
    MOOV2_WHITELIST,
    signer
  );
  const tokenDep = await deployments.get("VotingToken");
  const xtr = await ethers.getContractAt(tokenDep.abi, tokenDep.address, signer);

  // 1. Whitelist (covers both requester + proposer).
  if (await wl.isOnWhitelist(TARGET)) {
    console.log("\n[1] TARGET already on MOOv2 whitelist ✓");
  } else {
    console.log("\n[1] addToWhitelist(TARGET)");
    await (await wl.addToWhitelist(TARGET)).wait();
  }

  // 2. Mint XTR (skip if already funded to avoid double-mint on re-run).
  const bal = await xtr.balanceOf(TARGET);
  if (bal.gte(MINT_AMOUNT)) {
    console.log(
      `[2] TARGET already holds ${ethers.utils.formatUnits(bal, 18)} XTR (>= ${ethers.utils.formatUnits(
        MINT_AMOUNT,
        18
      )}) — skipping mint`
    );
  } else {
    console.log(`[2] mint(TARGET, ${ethers.utils.formatUnits(MINT_AMOUNT, 18)} XTR)`);
    await (await xtr.mint(TARGET, MINT_AMOUNT)).wait();
  }

  console.log("\nFinal state:");
  console.log("  MOOv2 whitelist members:", await wl.getWhitelist());
  console.log("  TARGET XTR balance     :", ethers.utils.formatUnits(await xtr.balanceOf(TARGET), 18), "XTR");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
