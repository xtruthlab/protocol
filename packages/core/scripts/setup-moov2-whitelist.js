// Add (authorize) addresses on the MOOv2 proposer/requester AddressWhitelist.
// MOOv2 uses ONE whitelist (0x983ac4…) for both roles, so adding an address
// here authorizes it to BOTH create requests and propose answers. Owner-only
// (the AddressWhitelist owner = deployer). Whitelist is fully dynamic — remove
// with removeFromWhitelist(addr) any time.
//
// Run (default adds the deployer/signer):
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   yarn hardhat run scripts/setup-moov2-whitelist.js --network xlayer-testnet
// Add specific addresses (CSV):
//   WHITELIST_ADD=0xabc...,0xdef... yarn hardhat run scripts/... --network xlayer-testnet
const hre = require("hardhat");
const { ethers } = hre;

// Env-overridable (MOOV2_WHITELIST) so this works on mainnet; falls back to
// the canonical X Layer testnet proposer/requester whitelist.
const WHITELIST = process.env.MOOV2_WHITELIST || "0x983ac45b12F06d34D8131A1C12555608E1A857c6";

async function main() {
  const [signer] = await ethers.getSigners();
  const wl = new ethers.Contract(
    WHITELIST,
    [
      "function addToWhitelist(address)",
      "function removeFromWhitelist(address)",
      "function isOnWhitelist(address) view returns (bool)",
      "function getWhitelist() view returns (address[])",
      "function owner() view returns (address)",
    ],
    signer
  );

  const owner = await wl.owner();
  console.log("signer:", signer.address);
  console.log("whitelist:", WHITELIST, "owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("signer is not the whitelist owner");
  }

  const toAdd = (process.env.WHITELIST_ADD || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const addrs = toAdd.length ? toAdd : [signer.address]; // default: the deployer

  for (const a of addrs) {
    if (!ethers.utils.isAddress(a)) {
      console.log("  skip invalid:", a);
      continue;
    }
    if (await wl.isOnWhitelist(a)) {
      console.log("  already on whitelist:", a);
    } else {
      const tx = await wl.addToWhitelist(a);
      await tx.wait();
      console.log("  added:", a, tx.hash);
    }
  }

  console.log("\nwhitelist now:", await wl.getWhitelist());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
