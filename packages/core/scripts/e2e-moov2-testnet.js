// Create real MOOv2 activity on X Layer testnet so the subgraph + dapp have
// data to show: requestPrice -> proposePrice (both from the whitelisted
// deployer EOA). Optionally settles a previously-proposed request once its
// liveness has elapsed (SETTLE_ID=<requester,identifier,timestamp,ancillary>
// is not needed — pass SETTLE_TS + the same CLAIM to re-derive).
//
// Run (create + propose):
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   CLAIM="Will the xtruth MOOv2 demo resolve YES?" \
//   yarn hardhat run scripts/e2e-moov2-testnet.js --network xlayer-testnet
//
// Settle later (after liveness, ~2h): re-run with SETTLE_TS=<the printed ts>
//   SETTLE_TS=1779999999 CLAIM="...same claim..." yarn hardhat run scripts/... --network xlayer-testnet
const hre = require("hardhat");
const { ethers } = hre;

const MOOV2 = "0x88f80d0cd78b8d014032c8862dce1b91662330d8";
const WOKB = "0x4200000000000000000000000000000000000006";
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");

const mooAbi = [
  "function requestPrice(bytes32 identifier,uint256 timestamp,bytes ancillaryData,address currency,uint256 reward) returns (uint256)",
  "function proposePrice(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData,int256 proposedPrice) returns (uint256)",
  "function settle(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) returns (uint256)",
  "function getState(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) view returns (uint8)",
  "function getRequest(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) view returns (tuple(address proposer,address disputer,address currency,bool settled,tuple(bool eventBased,bool refundOnDispute,bool callbackOnPriceProposed,bool callbackOnPriceDisputed,bool callbackOnPriceSettled,uint256 bond,uint256 customLiveness) requestSettings,int256 proposedPrice,int256 resolvedPrice,uint256 expirationTime,uint256 reward,uint256 finalFee))",
];
const erc20Abi = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const STATES = ["Invalid", "Requested", "Proposed", "Expired", "Disputed", "Resolved", "Settled"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [signer] = await ethers.getSigners();
  const moo = new ethers.Contract(MOOV2, mooAbi, signer);
  const wokb = new ethers.Contract(WOKB, erc20Abi, signer);

  const claim = process.env.CLAIM || "Will the xtruth MOOv2 demo resolve YES?";
  const settleTs = process.env.SETTLE_TS ? Number(process.env.SETTLE_TS) : null;
  // TS pins the request timestamp so a re-run continues the SAME request
  // (the load-balanced RPC has read-after-write lag, so request + propose may
  // need two passes). SETTLE_TS implies the settle path.
  const ts = settleTs ?? (process.env.TS ? Number(process.env.TS) : Math.floor(Date.now() / 1000));
  const ancillary = ethers.utils.toUtf8Bytes(`q:${claim}`);

  // Poll getState until it reaches one of `wanted` (RPC read-after-write lag).
  async function waitForState(wanted, tries = 12) {
    for (let i = 0; i < tries; i++) {
      const s = await moo.getState(signer.address, ASSERT_TRUTH, ts, ancillary);
      if (wanted.includes(s)) return s;
      await sleep(3000);
    }
    return moo.getState(signer.address, ASSERT_TRUTH, ts, ancillary);
  }

  console.log("signer:", signer.address);
  console.log("identifier: ASSERT_TRUTH  currency: WOKB");
  console.log("timestamp:", ts, "claim:", claim);

  const state0 = await moo.getState(signer.address, ASSERT_TRUTH, ts, ancillary);
  console.log("current state:", STATES[state0]);

  // ---- settle path ----
  if (settleTs) {
    if (state0 === 3 /* Expired*/ || state0 === 5 /* Resolved*/) {
      const tx = await moo.settle(signer.address, ASSERT_TRUTH, ts, ancillary);
      console.log("settle tx:", tx.hash);
      await tx.wait();
      const r = await moo.getRequest(signer.address, ASSERT_TRUTH, ts, ancillary);
      console.log(
        "settled. resolvedPrice:",
        r.resolvedPrice.toString(),
        "state:",
        STATES[await moo.getState(signer.address, ASSERT_TRUTH, ts, ancillary)]
      );
    } else {
      const r = await moo.getRequest(signer.address, ASSERT_TRUTH, ts, ancillary);
      const now = Math.floor(Date.now() / 1000);
      console.log(
        `not settleable yet (state=${STATES[state0]}). expirationTime=${r.expirationTime} now=${now} -> wait ${Math.max(
          0,
          r.expirationTime - now
        )}s`
      );
    }
    return;
  }

  // ---- request ----
  if (state0 !== 0 /* Invalid*/) {
    console.log("request already exists in state", STATES[state0], "- skipping requestPrice");
  } else {
    const tx1 = await moo.requestPrice(ASSERT_TRUTH, ts, ancillary, WOKB, 0);
    console.log("requestPrice tx:", tx1.hash);
    await tx1.wait();
    console.log("  -> Requested (waiting for RPC to reflect state…)");
  }

  // ---- propose ----
  // Poll until the node reflects Requested (skip if already past it).
  const stateAfterReq = await waitForState([1, 2, 3, 4, 5, 6]);
  if (stateAfterReq === 1 /* Requested*/) {
    const r = await moo.getRequest(signer.address, ASSERT_TRUTH, ts, ancillary);
    const totalBond = r.requestSettings.bond.add(r.finalFee);
    const allow = await wokb.allowance(signer.address, MOOV2);
    if (allow.lt(totalBond)) {
      const txa = await wokb.approve(MOOV2, ethers.constants.MaxUint256);
      console.log("approve WOKB tx:", txa.hash);
      await txa.wait();
    }
    const proposed = ethers.utils.parseEther("1"); // 1e18 = "true" for ASSERT_TRUTH
    const tx2 = await moo.proposePrice(signer.address, ASSERT_TRUTH, ts, ancillary, proposed);
    console.log("proposePrice tx:", tx2.hash, "(proposed = 1e18 / YES)");
    await tx2.wait();
  } else {
    console.log("not in Requested state, skipping propose (state:", STATES[stateAfterReq], ")");
  }

  const r = await moo.getRequest(signer.address, ASSERT_TRUTH, ts, ancillary);
  const finalState = await moo.getState(signer.address, ASSERT_TRUTH, ts, ancillary);
  console.log("\n-- result --");
  console.log("state:", STATES[finalState]);
  console.log("proposer:", r.proposer, "proposedPrice:", r.proposedPrice.toString());
  console.log("expirationTime:", r.expirationTime.toString(), "(settleable after this unix time)");
  console.log("\nTo settle later, re-run with:");
  console.log(
    `  SETTLE_TS=${ts} CLAIM=${JSON.stringify(
      claim
    )} yarn hardhat run scripts/e2e-moov2-testnet.js --network xlayer-testnet`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
