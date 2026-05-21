// End-to-end functional test of the CANONICAL xtruth deployment on X Layer
// testnet. Covers: deployment sanity (reads), faucet drip, XTR stake,
// emission reads, and an OOv3 assertTruth with a WOKB bond. Prints the new
// assertionId at the end so the subgraph indexing can be checked separately.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/e2e-canonical.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;

const WOKB = "0x4200000000000000000000000000000000000006";
const USDC_TEST = "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d";
const FAUCET = "0x26cd1D58626Cc6B66Fa6BC4FF534A9aae068bbeD";
const MOOV2 = "0x88f80d0cd78b8d014032c8862dce1b91662330d8";
const MINTER_ROLE = 1;
const ZERO = ethers.constants.AddressZero;
const HASH_ZERO = ethers.constants.HashZero;

let pass = 0,
  fail = 0;
function ok(l, v) {
  pass++;
  console.log(`  ✓ ${l}${v !== undefined ? `: ${v}` : ""}`);
}
function bad(l, v) {
  fail++;
  console.log(`  ✗ ${l}${v !== undefined ? `: ${v}` : ""}`);
}
function assert(cond, l, v) {
  cond ? ok(l, v) : bad(l, v);
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address, "\n");

  const get = async (n) => {
    const d = await deployments.get(n);
    return ethers.getContractAt(d.abi, d.address, signer);
  };
  const vv2 = await get("VotingV2");
  const xtr = await get("VotingToken");
  const oov3 = await get("OptimisticOracleV3");
  const aw = await get("AddressWhitelist");
  const store = await get("Store");
  const erc20 = (addr) =>
    ethers.getContractAt(
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
        "function deposit() payable",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
      ],
      addr,
      signer
    );

  // ---- A. Deployment sanity (reads) ----
  console.log("== A. Deployment sanity ==");
  assert((await vv2.votingToken()).toLowerCase() === xtr.address.toLowerCase(), "VotingV2.votingToken == XTR");
  const emission = await vv2.emissionRate();
  assert(emission.gt(0), "VotingV2.emissionRate > 0", ethers.utils.formatEther(emission) + "/s");
  ok("VotingV2.gat", ethers.utils.formatEther(await vv2.gat()));
  ok("VotingV2.spat", (await vv2.spat()).toString());
  ok("VotingV2.unstakeCoolDown", (await vv2.unstakeCoolDown()).toString() + "s");
  ok("VotingV2.owner", await vv2.owner());
  assert((await xtr.symbol()) === "XTR", "XTR.symbol", await xtr.symbol());
  assert(await xtr.holdsRole(MINTER_ROLE, FAUCET), "Faucet holds XTR Minter role");
  const defCur = await oov3.defaultCurrency();
  assert(defCur.toLowerCase() === WOKB.toLowerCase(), "OOv3.defaultCurrency == WOKB", defCur);
  for (const [n, a] of [
    ["WOKB", WOKB],
    ["USDC_TEST", USDC_TEST],
  ]) {
    assert(await aw.isOnWhitelist(a), `AddressWhitelist ${n}`);
    const mb = await oov3.getMinimumBond(a);
    assert(mb.gt(0), `OOv3.getMinimumBond(${n})`, mb.toString());
    const ff = await store.computeFinalFee(a);
    assert(ff.rawValue.gt(0), `Store.finalFee(${n})`, ff.rawValue.toString());
  }
  const faucet = await ethers.getContractAt(
    [
      "function drip()",
      "function dripAmount() view returns (uint256)",
      "function cooldown() view returns (uint256)",
      "function nextDripTime(address) view returns (uint256)",
    ],
    FAUCET,
    signer
  );
  ok("Faucet.dripAmount", ethers.utils.formatEther(await faucet.dripAmount()));
  ok("Faucet.cooldown", (await faucet.cooldown()).toString() + "s");
  const moov2Code = await ethers.provider.getCode(MOOV2);
  assert(moov2Code !== "0x", "MOOv2 has code");

  // ---- B. Faucet drip ----
  console.log("\n== B. Faucet drip ==");
  const xtrBefore = await xtr.balanceOf(signer.address);
  const next = await faucet.nextDripTime(signer.address);
  const now = Math.floor(Date.now() / 1000);
  if (next.gt(now)) {
    console.log(`  ⊘ drip skipped (cooldown until ${next}); balance read instead`);
    ok("XTR balance", ethers.utils.formatEther(xtrBefore));
  } else {
    const tx = await faucet.drip();
    await tx.wait();
    const xtrAfter = await xtr.balanceOf(signer.address);
    assert(xtrAfter.gt(xtrBefore), "drip minted XTR", ethers.utils.formatEther(xtrAfter.sub(xtrBefore)));
  }

  // ---- C. Stake ----
  console.log("\n== C. Stake XTR ==");
  const stakeAmt = ethers.utils.parseEther("100");
  const bal = await xtr.balanceOf(signer.address);
  if (bal.lt(stakeAmt)) {
    bad("insufficient XTR to stake", ethers.utils.formatEther(bal));
  } else {
    const before = (await vv2.voterStakes(signer.address)).stake;
    const allow = await xtr.allowance(signer.address, vv2.address);
    if (allow.lt(stakeAmt)) {
      await (await xtr.approve(vv2.address, stakeAmt)).wait();
      ok("approve XTR → VotingV2");
    } else ok("allowance already sufficient");
    await (await vv2.stake(stakeAmt)).wait();
    const after = (await vv2.voterStakes(signer.address)).stake;
    assert(after.sub(before).eq(stakeAmt), "stake increased voterStakes.stake", ethers.utils.formatEther(after));
    const outstanding = await vv2.outstandingRewards(signer.address);
    ok("outstandingRewards(signer)", ethers.utils.formatEther(outstanding));
  }

  // ---- D. Assert (OOv3, WOKB bond) ----
  console.log("\n== D. assertTruth (WOKB bond) ==");
  const wokb = await erc20(WOKB);
  const bond = await oov3.getMinimumBond(WOKB);
  const wokbBal = await wokb.balanceOf(signer.address);
  if (wokbBal.lt(bond)) {
    await (await wokb.deposit({ value: bond.sub(wokbBal) })).wait();
    ok("wrapped OKB → WOKB", ethers.utils.formatEther(bond.sub(wokbBal)));
  }
  if ((await wokb.allowance(signer.address, oov3.address)).lt(bond)) {
    await (await wokb.approve(oov3.address, bond)).wait();
    ok("approve WOKB → OOv3");
  }
  const claim = ethers.utils.toUtf8Bytes("xtruth canonical e2e test assertion @ " + new Date().toISOString());
  const idBytes = ethers.utils.formatBytes32String("ASSERT_TRUTH");
  const tx = await oov3.assertTruth(
    claim,
    signer.address, // asserter
    ZERO, // callbackRecipient
    ZERO, // escalationManager
    7200, // liveness
    WOKB,
    bond,
    idBytes,
    HASH_ZERO
  );
  const rcpt = await tx.wait();
  let assertionId;
  for (const log of rcpt.logs) {
    try {
      const p = oov3.interface.parseLog(log);
      if (p.name === "AssertionMade") {
        assertionId = p.args.assertionId;
        break;
      }
    } catch {
      /* not the AssertionMade log — skip */
    }
  }
  assert(Boolean(assertionId), "AssertionMade event emitted", assertionId);

  console.log("\n========================================");
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (assertionId) console.log(`ASSERTION_ID=${assertionId}`);
  console.log("========================================");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
