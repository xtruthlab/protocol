// One-off: add an address to the mainnet MOOv2 requester whitelist.
//
// PREREQUISITE
//   .env PRIVATE_KEY must be the MAINNET deployer key (the AddressWhitelist
//   owner). For chainId 196 that's 0x1F53Be6BDe296C20393d71Eb20233Faae3480B80.
//   The testnet deployer (0xfAf4...95A1) does not own the mainnet whitelist;
//   running this script with the wrong key reverts with "Ownable: caller is
//   not the owner".
//
// USAGE
//   cd packages/core
//   yarn hardhat run scripts/regression/add-to-moov2-requester-wl.js --network xlayer

const hre = require("hardhat");
const { ethers } = hre;

// Edit this list to add more addresses in one tx batch.
const ADDRESSES_TO_ADD = ["0x6474175656F4374cBe83391B19090407aef8e165"];

const MAINNET_MOOV2 = "0xde9472548e9d92f019c86e243386a57c36d28ae1";

const ADDRESS_WHITELIST_ABI = [
  "function isOnWhitelist(address) view returns (bool)",
  "function addToWhitelist(address)",
  "function owner() view returns (address)",
];

const MOOV2_VIEW_ABI = ["function requesterWhitelist() view returns (address)"];

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) {
    throw new Error(`Refusing to run on chainId ${chainId}. Mainnet (196) only.`);
  }

  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const moov2 = new ethers.Contract(MAINNET_MOOV2, MOOV2_VIEW_ABI, signer);
  const wlAddr = await moov2.requesterWhitelist();
  const wl = new ethers.Contract(wlAddr, ADDRESS_WHITELIST_ABI, signer);

  console.log("MOOv2:", MAINNET_MOOV2);
  console.log("Requester whitelist:", wlAddr);

  const owner = await wl.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Whitelist owner is ${owner}, not the signer ${signer.address}. ` +
        `Swap .env PRIVATE_KEY to the mainnet deployer (0x1F53...0B80) and re-run.`
    );
  }

  for (const addr of ADDRESSES_TO_ADD) {
    const already = await wl.isOnWhitelist(addr);
    if (already) {
      console.log(`  • ${addr} already on whitelist — skip`);
      continue;
    }
    console.log(`  → addToWhitelist(${addr})`);
    const tx = await wl.addToWhitelist(addr);
    console.log(`    tx: ${tx.hash}`);
    await tx.wait();
    console.log(`    ✅ added`);
  }

  console.log("\nFinal state:");
  for (const addr of ADDRESSES_TO_ADD) {
    const on = await wl.isOnWhitelist(addr);
    console.log(`  ${addr}  ${on ? "✅ on whitelist" : "❌ NOT on whitelist"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
