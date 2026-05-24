/* eslint-disable no-empty */
// Full lifecycle E2E across OOv3, OOv2, MOOv2 on the live X Layer testnet,
// against the REAL VotingV2 DVM. Phase-driven + resumable (state in
// /tmp/e2e-oracles-state.json) because a dispute→vote→settle cycle spans a real
// voting round (~30-60 min).
//
// Scenarios per oracle: undisputed→settle, undisputed→expired-no-settle,
// disputed→proposer/asserter wins, disputed→disputer wins. (+ requested-only
// for OOv2/MOOv2.)
//
// Run (env from .env, with the working RPC):
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   PHASE=setup   yarn hardhat run scripts/e2e-oracles-testnet.js --network xlayer-testnet
//   PHASE=settleUndisputed ...   (after ~130s)
//   PHASE=commit  ...            (when round N+1 is in Commit phase)
//   PHASE=reveal  ...            (when round N+1 is in Reveal phase)
//   PHASE=settle  ...            (after round N+1 ends)
//   PHASE=status  ...            (anytime — dump all instance states)
const hre = require("hardhat");
const fs = require("fs");
const { ethers } = hre;

const STATE_FILE = "/tmp/e2e-oracles-state.json";

const A = {
  OOV3: "0xa6d5B5b1e71AC1D12041997b9583CDb3A5DC5b1b",
  OOV2: "0xeF3e851F7BdfaC5491B562b90D8bc5209524a7C2",
  MOOV2: "0x88f80d0cd78b8d014032c8862dce1b91662330d8",
  VV2: "0xAB332A31bFA83f24CF5415f8443C32C6F7788a9E",
  XTR: "0x44B706e1d8b6883677c7c92DC386d96c9B5650F3",
  WOKB: "0x4200000000000000000000000000000000000006",
};
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");
const TRUE = ethers.utils.parseEther("1"); // 1e18
const FALSE = ethers.constants.Zero;

const oov3Abi = [
  "function assertTruth(bytes claim,address asserter,address callbackRecipient,address escalationManager,uint64 liveness,address currency,uint256 bond,bytes32 identifier,bytes32 domainId) returns (bytes32)",
  "function disputeAssertion(bytes32 assertionId,address disputer)",
  "function settleAssertion(bytes32 assertionId)",
  "function getMinimumBond(address currency) view returns (uint256)",
  "function getAssertion(bytes32 assertionId) view returns (tuple(bool arbitrateViaEscalationManager,bool discardOracle,bool validateDisputers,address assertingCaller,address escalationManager) escalationManagerSettings,address asserter,uint64 assertionTime,bool settled,address currency,uint64 expirationTime,bool settlementResolution,bytes32 domainId,bytes32 identifier,uint256 bond,address callbackRecipient,address disputer)",
];
const oov2Abi = [
  "function requestPrice(bytes32 identifier,uint256 timestamp,bytes ancillaryData,address currency,uint256 reward) returns (uint256)",
  "function proposePrice(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData,int256 proposedPrice) returns (uint256)",
  "function setCustomLiveness(bytes32 identifier,uint256 timestamp,bytes ancillaryData,uint256 customLiveness)",
  "function disputePrice(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) returns (uint256)",
  "function settle(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) returns (uint256)",
  "function getState(address requester,bytes32 identifier,uint256 timestamp,bytes ancillaryData) view returns (uint8)",
];
const mooAbi = oov2Abi.concat([
  "function requestManagerSetCustomLiveness(address requester,bytes32 identifier,bytes ancillaryData,uint256 customLiveness)",
  "function setMinimumLiveness(uint256)",
  "function minimumLiveness() view returns (uint256)",
  "function addRequestManager(address)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function REQUEST_MANAGER_ROLE() view returns (bytes32)",
]);
const vv2Abi = [
  "function getCurrentRoundId() view returns (uint256)",
  "function getVotePhase() view returns (uint8)",
  "function voteTiming() view returns (uint256)",
  "function getRoundEndTime(uint256) view returns (uint256)",
  "function getPendingRequests() view returns (tuple(uint32 lastVotingRound,bool isGovernance,uint64 time,uint32 rollCount,bytes32 identifier,bytes ancillaryData)[])",
  "function commitVote(bytes32 identifier,uint256 time,bytes ancillaryData,bytes32 hash)",
  "function revealVote(bytes32 identifier,uint256 time,int256 price,bytes ancillaryData,int256 salt)",
  "function voterStakes(address) view returns (uint128 stake,uint128 pendingUnstake,uint128 rewardsPaidPerToken,uint128 outstandingRewards,int128 unappliedSlash,uint64 nextIndexToProcess,uint64 unstakeTime,address delegate)",
];
const wokbAbi = [
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];
const STATES = ["Invalid", "Requested", "Proposed", "Expired", "Disputed", "Resolved", "Settled"];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { instances: [] };
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function main() {
  const phase = process.env.PHASE || "status";
  const [signer] = await ethers.getSigners();
  const me = signer.address;
  const oov3 = new ethers.Contract(A.OOV3, oov3Abi, signer);
  const oov2 = new ethers.Contract(A.OOV2, oov2Abi, signer);
  const moo = new ethers.Contract(A.MOOV2, mooAbi, signer);
  const vv2 = new ethers.Contract(A.VV2, vv2Abi, signer);
  const wokb = new ethers.Contract(A.WOKB, wokbAbi, signer);

  const fns = { setup, settleUndisputed, commit, reveal, settle, status, recover };
  if (!fns[phase]) throw new Error("unknown PHASE: " + phase);
  await fns[phase]({ signer, me, oov3, oov2, moo, vv2, wokb });
}

async function roundInfo(vv2) {
  const [pl, rid, ph] = await Promise.all([vv2.voteTiming(), vv2.getCurrentRoundId(), vv2.getVotePhase()]);
  const ret = await vv2.getRoundEndTime(rid);
  const now = Math.floor(Date.now() / 1000);
  console.log(`round=${rid} phase=${ph == 0 ? "Commit" : "Reveal"} phaseLength=${pl} roundEndsIn=${ret - now}s`);
  return { phaseLength: Number(pl), roundId: rid.toString(), phase: Number(ph), roundEnd: Number(ret), now };
}

async function status({ vv2, oov2, moo, oov3 }) {
  const s = loadState();
  await roundInfo(vv2);
  for (const i of s.instances) {
    let st = "?";
    try {
      if (i.oracle === "OOV3") {
        const a = await oov3.getAssertion(i.assertionId);
        st = a.settled
          ? "settled(" + a.settlementResolution + ")"
          : a.disputer !== ethers.constants.AddressZero
          ? "disputed"
          : "open";
      } else {
        const c = i.oracle === "OOV2" ? oov2 : moo;
        st = STATES[await c.getState(i.requester, ASSERT_TRUTH, i.time, i.ancillary)];
      }
    } catch (e) {
      st = "err:" + (e.reason || e.message || "").slice(0, 40);
    }
    console.log(`  [${i.oracle}/${i.kind}] ${i.label} -> ${st}`);
  }
  const pend = await vv2.getPendingRequests();
  console.log("pending DVM requests:", pend.length);
}

async function ensureWokb({ me, wokb }) {
  const bal = await wokb.balanceOf(me);
  if (bal.lt(ethers.utils.parseEther("0.01"))) {
    const tx = await wokb.deposit({ value: ethers.utils.parseEther("0.02") });
    console.log("wrap 0.02 OKB->WOKB:", tx.hash);
    await tx.wait();
  }
  const allow = await wokb.allowance(me, A.OOV3);
  if (allow.lt(ethers.utils.parseEther("0.01"))) {
    for (const spender of [A.OOV3, A.OOV2, A.MOOV2]) {
      const tx = await wokb.approve(spender, ethers.constants.MaxUint256);
      await tx.wait();
      console.log("approve WOKB ->", spender);
    }
  }
}

async function setup(ctx) {
  const { me, oov3, oov2, moo, vv2 } = ctx;
  await ensureWokb(ctx);
  const ri = await roundInfo(vv2);

  // Lower MOOv2 minimumLiveness so undisputed MOOv2 requests can settle fast.
  try {
    const min = await moo.minimumLiveness();
    if (min.gt(60)) {
      const tx = await moo.setMinimumLiveness(60);
      await tx.wait();
      console.log("MOOv2 minimumLiveness -> 60");
    }
    const ROLE = await moo.REQUEST_MANAGER_ROLE();
    if (!(await moo.hasRole(ROLE, me))) {
      const tx = await moo.addRequestManager(me);
      await tx.wait();
      console.log("granted REQUEST_MANAGER to self");
    }
  } catch (e) {
    console.log("MOOv2 config note:", e.reason || e.message);
  }

  const minBond = await oov3.getMinimumBond(A.WOKB);
  console.log("OOv3 minBond(WOKB):", ethers.utils.formatEther(minBond));

  const state = { instances: [], setupRound: ri.roundId, createdAt: ri.now };
  const nonce0 = Math.floor(Date.now() / 1000);
  let n = 0;
  const uniq = () => `xtruth-e2e-${nonce0}-${n++}`;

  // ---- OOv3 (assertion model) ----
  async function oov3Assert(kind, liveness, label) {
    const claim = `${label} [${uniq()}]`;
    const tx = await oov3.assertTruth(
      ethers.utils.toUtf8Bytes(claim),
      me,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      liveness,
      A.WOKB,
      minBond,
      ASSERT_TRUTH,
      ethers.constants.HashZero
    );
    const rc = await tx.wait();
    // assertionId is the return; recover from logs via getAssertion is hard, so parse AssertionMade event topic[1]
    let assertionId = null;
    for (const lg of rc.logs) {
      if (lg.address.toLowerCase() === A.OOV3.toLowerCase() && lg.topics.length >= 2) {
        assertionId = lg.topics[1];
        break;
      }
    }
    console.log(`OOv3 ${kind}: assert ${tx.hash} id=${assertionId}`);
    return { oracle: "OOV3", kind, label, claim, assertionId, liveness };
  }

  state.instances.push(await oov3Assert("settle", 120, "OOv3 undisputed→settle"));
  state.instances.push(await oov3Assert("nosettle", 120, "OOv3 undisputed→no-settle"));
  const o3pw = await oov3Assert("disp_assertWins", 600, "OOv3 disputed→asserter wins");
  state.instances.push(o3pw);
  const o3dw = await oov3Assert("disp_disputerWins", 600, "OOv3 disputed→disputer wins");
  state.instances.push(o3dw);
  // dispute the two dispute-scenario OOv3 assertions
  for (const i of [o3pw, o3dw]) {
    const tx = await oov3.disputeAssertion(i.assertionId, me);
    await tx.wait();
    console.log(`OOv3 dispute ${i.kind}: ${tx.hash}`);
    i.voteFor = i.kind === "disp_assertWins" ? TRUE.toString() : FALSE.toString(); // assertion claim = TRUE
    i.matchKey = i.assertionId.slice(2).toLowerCase(); // OOv3 stamps assertionId into DVM ancillary
  }

  // ---- OOv2 / MOOv2 (price-request model) ----
  async function priceLifecycle(c, oracle, kind, label, opts) {
    const time = Math.floor(Date.now() / 1000);
    const claim = `${label} [${uniq()}]`;
    const ancillary = ethers.utils.toUtf8Bytes(`q:${claim}`);
    const tx1 = await c.requestPrice(ASSERT_TRUTH, time, ancillary, A.WOKB, 0);
    await tx1.wait();
    const inst = { oracle, kind, label, claim, requester: me, time, ancillary: ethers.utils.hexlify(ancillary) };
    if (opts.requestedOnly) {
      console.log(`${oracle} ${kind}: requested only ${tx1.hash}`);
      return inst;
    }
    // short custom liveness for fast settle (skip for dispute scenarios)
    if (opts.liveness) {
      try {
        if (oracle === "MOOV2") {
          const tx = await c.requestManagerSetCustomLiveness(me, ASSERT_TRUTH, ancillary, opts.liveness);
          await tx.wait();
        } else {
          const tx = await c.setCustomLiveness(ASSERT_TRUTH, time, ancillary, opts.liveness);
          await tx.wait();
        }
      } catch (e) {
        console.log("  setCustomLiveness note:", e.reason || e.message);
      }
    }
    const tx2 = await c.proposePrice(me, ASSERT_TRUTH, time, ancillary, TRUE);
    await tx2.wait();
    console.log(`${oracle} ${kind}: request+propose ${tx2.hash}`);
    if (opts.dispute) {
      const tx3 = await c.disputePrice(me, ASSERT_TRUTH, time, ancillary);
      await tx3.wait();
      console.log(`${oracle} ${kind}: dispute ${tx3.hash}`);
      inst.voteFor = kind === "disp_proposerWins" ? TRUE.toString() : FALSE.toString(); // proposed = TRUE
      inst.matchKey = `q:${claim}`; // DVM ancillary = original + ,ooRequester:...
    }
    return inst;
  }

  for (const [oracle, c] of [
    ["OOV2", oov2],
    ["MOOV2", moo],
  ]) {
    state.instances.push(await priceLifecycle(c, oracle, "settle", `${oracle} undisputed→settle`, { liveness: 120 }));
    state.instances.push(
      await priceLifecycle(c, oracle, "nosettle", `${oracle} undisputed→no-settle`, { liveness: 120 })
    );
    state.instances.push(
      await priceLifecycle(c, oracle, "disp_proposerWins", `${oracle} disputed→proposer wins`, { dispute: true })
    );
    state.instances.push(
      await priceLifecycle(c, oracle, "disp_disputerWins", `${oracle} disputed→disputer wins`, { dispute: true })
    );
    state.instances.push(
      await priceLifecycle(c, oracle, "requested", `${oracle} requested-only`, { requestedOnly: true })
    );
  }

  saveState(state);
  console.log(`\nSaved ${state.instances.length} instances to ${STATE_FILE}`);
  await roundInfo(vv2);
  console.log("\nNEXT: when round flips to the NEXT round's Commit phase, run PHASE=commit.");
  console.log("Also run PHASE=settleUndisputed after ~130s to settle the short-liveness undisputed ones.");
}

// Recovery after a mid-setup crash: the OOv3x2 + OOv2x2 disputes already landed
// in the DVM but weren't tracked. Re-create the 2 MOOv2 disputes (registration
// is now fixed) so all disputes share one round, and write a clean tracked
// state for the ones we can settle precisely (OOv3 by id via env, MOOv2 by
// original time/ancillary). OOv2 orphans get voted (resolve) but not tracked
// for settle. Env: OOV3_WINS=<assertionId> OOV3_LOSES=<assertionId>.
async function recover(ctx) {
  const { me, moo, vv2 } = ctx;
  await ensureWokb(ctx);
  const state = { instances: [], recoveredAt: Math.floor(Date.now() / 1000) };
  if (process.env.OOV3_WINS)
    state.instances.push({
      oracle: "OOV3",
      kind: "disp_assertWins",
      label: "OOv3 disputed→asserter wins",
      assertionId: process.env.OOV3_WINS,
      voteFor: TRUE.toString(),
      matchKey: process.env.OOV3_WINS.slice(2).toLowerCase(),
    });
  if (process.env.OOV3_LOSES)
    state.instances.push({
      oracle: "OOV3",
      kind: "disp_disputerWins",
      label: "OOv3 disputed→disputer wins",
      assertionId: process.env.OOV3_LOSES,
      voteFor: FALSE.toString(),
      matchKey: process.env.OOV3_LOSES.slice(2).toLowerCase(),
    });

  for (const kind of ["disp_proposerWins", "disp_disputerWins"]) {
    const time = Math.floor(Date.now() / 1000);
    const label = `MOOV2 disputed→${kind === "disp_proposerWins" ? "proposer" : "disputer"} wins`;
    const claim = `${label} [recover-${time}]`;
    const ancillary = ethers.utils.toUtf8Bytes(`q:${claim}`);
    await (await moo.requestPrice(ASSERT_TRUTH, time, ancillary, A.WOKB, 0)).wait();
    await (await moo.proposePrice(me, ASSERT_TRUTH, time, ancillary, TRUE)).wait();
    const d = await moo.disputePrice(me, ASSERT_TRUTH, time, ancillary);
    await d.wait();
    console.log(`MOOV2 ${kind}: request+propose+dispute ${d.hash}`);
    state.instances.push({
      oracle: "MOOV2",
      kind,
      label,
      requester: me,
      time,
      ancillary: ethers.utils.hexlify(ancillary),
      voteFor: (kind === "disp_proposerWins" ? TRUE : FALSE).toString(),
      matchKey: `q:${claim}`,
    });
  }
  saveState(state);
  console.log(`\nTracked ${state.instances.length} disputed instances -> ${STATE_FILE}`);
  const pend = await vv2.getPendingRequests();
  console.log(
    "pending DVM requests now:",
    pend.length,
    "(rounds:",
    [...new Set(pend.map((p) => Number(p.lastVotingRound)))].join(","),
    ")"
  );
  await roundInfo(vv2);
}

async function settleUndisputed({ oov3, oov2, moo }) {
  const s = loadState();
  for (const i of s.instances) {
    if (i.kind !== "settle") continue;
    try {
      if (i.oracle === "OOV3") {
        const tx = await oov3.settleAssertion(i.assertionId);
        await tx.wait();
        console.log(`settled OOv3 ${i.kind}: ${tx.hash}`);
      } else {
        const c = i.oracle === "OOV2" ? oov2 : moo;
        const tx = await c.settle(i.requester, ASSERT_TRUTH, i.time, i.ancillary);
        await tx.wait();
        console.log(`settled ${i.oracle} ${i.kind}: ${tx.hash}`);
      }
      i.settled = true;
    } catch (e) {
      console.log(`  not settleable yet ${i.oracle}/${i.kind}: ${(e.reason || e.message || "").slice(0, 60)}`);
    }
  }
  saveState(s);
}

async function commit({ me, vv2 }) {
  const s = loadState();
  const ri = await roundInfo(vv2);
  if (ri.phase !== 0) {
    console.log("NOT in Commit phase — wait. (phase=Reveal)");
    return;
  }
  const pend = await vv2.getPendingRequests();
  console.log("pending DVM requests:", pend.length);
  s.commits = s.commits || {};
  for (const p of pend) {
    const anc = ethers.utils.toUtf8String(p.ancillaryData).toLowerCase();
    const ancHex = ethers.utils.hexlify(p.ancillaryData).toLowerCase();
    const inst = s.instances.find(
      (i) => i.matchKey && (anc.includes(i.matchKey.toLowerCase()) || ancHex.includes(i.matchKey.toLowerCase()))
    );
    // Untracked orphan (e.g. OOv2 from the crashed setup run): vote TRUE so it
    // resolves (proposer/asserter wins) rather than sitting unresolved.
    const label = inst ? inst.label : `orphan ${anc.slice(0, 40)}`;
    const price = inst ? ethers.BigNumber.from(inst.voteFor) : TRUE;
    const salt = ethers.BigNumber.from(ethers.utils.randomBytes(31)); // positive int256
    const hash = ethers.utils.solidityKeccak256(
      ["int256", "int256", "address", "uint256", "bytes", "uint256", "bytes32"],
      [price, salt, me, p.time, p.ancillaryData, p.lastVotingRound, p.identifier]
    );
    try {
      await vv2.callStatic.commitVote(p.identifier, p.time, p.ancillaryData, hash);
    } catch (e) {
      console.log(
        `  SKIP [${label}] commit would revert: ${(e.reason || e.error?.message || e.message || "").slice(0, 90)}`
      );
      continue;
    }
    const tx = await vv2.commitVote(p.identifier, p.time, p.ancillaryData, hash);
    await tx.wait();
    s.commits[label] = {
      price: price.toString(),
      salt: salt.toString(),
      time: ethers.BigNumber.from(p.time).toString(),
      ancillary: ethers.utils.hexlify(p.ancillaryData),
      identifier: p.identifier,
      roundId: Number(p.lastVotingRound),
    };
    saveState(s);
    console.log(`committed [${label}] price=${price} ${tx.hash}`);
  }
  saveState(s);
  console.log("\nNEXT: in the Reveal phase of the same round, run PHASE=reveal.");
}

async function reveal({ vv2 }) {
  const s = loadState();
  const ri = await roundInfo(vv2);
  if (ri.phase !== 1) {
    console.log("NOT in Reveal phase — wait. (phase=Commit)");
    return;
  }
  for (const [label, c] of Object.entries(s.commits || {})) {
    try {
      const tx = await vv2.revealVote(
        c.identifier,
        c.time,
        ethers.BigNumber.from(c.price),
        c.ancillary,
        ethers.BigNumber.from(c.salt)
      );
      await tx.wait();
      console.log(`revealed ${label}: ${tx.hash}`);
      c.revealed = true;
    } catch (e) {
      console.log(`  reveal failed ${label}: ${(e.reason || e.message || "").slice(0, 80)}`);
    }
  }
  saveState(s);
  console.log("\nNEXT: after the round ends (resolution), run PHASE=settle.");
}

async function settle({ oov3, oov2, moo }) {
  const s = loadState();
  for (const i of s.instances) {
    if (!i.matchKey) continue; // only the disputed ones resolve via DVM
    if (i.kind.includes("disputerWins") && i.leaveUnsettled) continue;
    try {
      if (i.oracle === "OOV3") {
        const tx = await oov3.settleAssertion(i.assertionId);
        await tx.wait();
        const a = await oov3.getAssertion(i.assertionId);
        console.log(
          `settled OOv3 ${i.kind}: resolution=${a.settlementResolution} (expected ${i.kind === "disp_assertWins"})`
        );
      } else {
        const c = i.oracle === "OOV2" ? oov2 : moo;
        const pay = await c.callStatic.settle(i.requester, ASSERT_TRUTH, i.time, i.ancillary);
        const tx = await c.settle(i.requester, ASSERT_TRUTH, i.time, i.ancillary);
        await tx.wait();
        console.log(`settled ${i.oracle} ${i.kind}: payout=${ethers.utils.formatEther(pay)} (${i.kind})`);
      }
      i.settled = true;
    } catch (e) {
      console.log(`  settle pending ${i.oracle}/${i.kind}: ${(e.reason || e.message || "").slice(0, 70)}`);
    }
  }
  saveState(s);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
