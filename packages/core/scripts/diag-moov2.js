// Read-only diagnostic for the live ManagedOptimisticOracleV2 (MOOv2) on
// X Layer testnet. Prints everything needed to construct a valid
// requestPrice -> proposePrice -> settle flow (whitelists, roles, bond ranges,
// final fees, balances). No transactions are sent.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   yarn hardhat run scripts/diag-moov2.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers } = hre;

const MOOV2 = "0x88f80d0cd78b8d014032c8862dce1b91662330d8";
const WOKB = "0x4200000000000000000000000000000000000006";
const USDC_TEST = "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d";
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");
const YES_NO = ethers.utils.formatBytes32String("YES_OR_NO_QUERY");

const mooAbi = [
  "function defaultLiveness() view returns (uint256)",
  "function minimumLiveness() view returns (uint256)",
  "function defaultProposerWhitelist() view returns (address)",
  "function requesterWhitelist() view returns (address)",
  "function allowedBondRanges(address) view returns (uint128 minimumBond, uint128 maximumBond)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function CONFIG_ADMIN_ROLE() view returns (bytes32)",
  "function REQUEST_MANAGER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function finder() view returns (address)",
];
const wlAbi = [
  "function isOnWhitelist(address) view returns (bool)",
  "function getWhitelist() view returns (address[])",
];
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
];
const finderAbi = ["function getImplementationAddress(bytes32) view returns (address)"];
const idWlAbi = ["function isIdentifierSupported(bytes32) view returns (bool)"];
const storeAbi = ["function computeFinalFee(address) view returns (tuple(uint256 rawValue))"];

async function main() {
  const [signer] = await ethers.getSigners();
  const moo = new ethers.Contract(MOOV2, mooAbi, signer);
  console.log("signer:", signer.address);
  console.log("native OKB balance:", ethers.utils.formatEther(await signer.getBalance()));

  const [defLiv, minLiv, propWl, reqWl, finder] = await Promise.all([
    moo.defaultLiveness(),
    moo.minimumLiveness(),
    moo.defaultProposerWhitelist(),
    moo.requesterWhitelist(),
    moo.finder(),
  ]);
  console.log("\n-- MOOv2 config --");
  console.log("defaultLiveness:", defLiv.toString(), "minimumLiveness:", minLiv.toString());
  console.log("defaultProposerWhitelist:", propWl);
  console.log("requesterWhitelist:", reqWl);
  console.log("finder:", finder);

  const [CONFIG, MGR, ADMIN] = await Promise.all([
    moo.CONFIG_ADMIN_ROLE(),
    moo.REQUEST_MANAGER_ROLE(),
    moo.DEFAULT_ADMIN_ROLE(),
  ]);
  console.log("\n-- signer roles --");
  console.log("DEFAULT_ADMIN:", await moo.hasRole(ADMIN, signer.address));
  console.log("CONFIG_ADMIN:", await moo.hasRole(CONFIG, signer.address));
  console.log("REQUEST_MANAGER:", await moo.hasRole(MGR, signer.address));

  const prop = new ethers.Contract(propWl, wlAbi, signer);
  const req = new ethers.Contract(reqWl, wlAbi, signer);
  console.log("\n-- whitelists --");
  console.log("signer on proposer WL:", await prop.isOnWhitelist(signer.address));
  console.log("signer on requester WL:", await req.isOnWhitelist(signer.address));
  console.log("proposer WL members:", await prop.getWhitelist());
  console.log("requester WL members:", await req.getWhitelist());

  const finderC = new ethers.Contract(finder, finderAbi, signer);
  const idWlAddr = await finderC.getImplementationAddress(ethers.utils.formatBytes32String("IdentifierWhitelist"));
  const storeAddr = await finderC.getImplementationAddress(ethers.utils.formatBytes32String("Store"));
  const collWlAddr = await finderC.getImplementationAddress(ethers.utils.formatBytes32String("CollateralWhitelist"));
  const idWl = new ethers.Contract(idWlAddr, idWlAbi, signer);
  const store = new ethers.Contract(storeAddr, storeAbi, signer);
  const collWl = new ethers.Contract(collWlAddr, wlAbi, signer);
  console.log("\n-- identifiers --");
  console.log("ASSERT_TRUTH supported:", await idWl.isIdentifierSupported(ASSERT_TRUTH));
  console.log("YES_OR_NO_QUERY supported:", await idWl.isIdentifierSupported(YES_NO));

  console.log("\n-- currencies --");
  for (const [name, addr] of [
    ["WOKB", WOKB],
    ["USDC_TEST", USDC_TEST],
  ]) {
    const t = new ethers.Contract(addr, erc20Abi, signer);
    let sym = name,
      dec = 18,
      bal = "?",
      fee = "?",
      onColl = "?",
      range = "?";
    try {
      sym = await t.symbol();
    } catch {
      /* ignore */
    }
    try {
      dec = await t.decimals();
    } catch {
      /* ignore */
    }
    try {
      bal = ethers.utils.formatUnits(await t.balanceOf(signer.address), dec);
    } catch (e) {
      bal = "err";
    }
    try {
      fee = ethers.utils.formatUnits((await store.computeFinalFee(addr)).rawValue, dec);
    } catch (e) {
      fee = "err";
    }
    try {
      onColl = String(await collWl.isOnWhitelist(addr));
    } catch {
      /* ignore */
    }
    try {
      const r = await moo.allowedBondRanges(addr);
      range = `[${r.minimumBond}, ${r.maximumBond}]`;
    } catch {
      /* ignore */
    }
    console.log(
      `${name} (${addr}) sym=${sym} dec=${dec} signerBal=${bal} finalFee=${fee} onCollWL=${onColl} bondRange=${range}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
