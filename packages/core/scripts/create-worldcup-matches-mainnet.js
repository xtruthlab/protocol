// Create World Cup match markets on X Layer MAINNET (196): per match, THREE
// independent binary (Yes/No) MOOv2 price requests. reward = 2 XTR per request
// (12 XTR total, requester pays — script handles the approval), DEFAULT bond
// (no custom bond). No propose. Mirrors the verified testnet batch.
//
// Note: mainnet XTR finalFee = 1.0, so the dapp shows 保证金 = 2 XTR
// (bond defaults to finalFee; display = bond + finalFee).
//
// Run (with YOUR mainnet key — NOT the testnet .env key). Signer must be on
// the MOOv2 requester whitelist: 0x1F53Be6B… / 0x6474175… / 0x6EFa1Fad… /
// 0xBA3BdCEE…, and hold ≥12 XTR + OKB for gas.
//   cd packages/core
//   export PRIVATE_KEY="0x<mainnet key>"
//   export NODE_URL_196="https://rpc.xlayer.tech"
//   yarn hardhat run scripts/create-worldcup-matches-mainnet.js --network xlayer
const hre = require("hardhat");
const { ethers } = hre;

const MOOV2 = "0xde9472548e9d92f019c86e243386a57c36d28ae1";
const XTR = "0x1819672530c65e1eF3a3f62fA8e6722655225a78";
const ADDRESS_WHITELIST = "0x278371F3aaC71669092Df46B4421c8b736f71f93";
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");
const REWARD = ethers.utils.parseEther("2");

const mooAbi = [
  "function requestPrice(bytes32,uint256,bytes,address,uint256) returns (uint256)",
  "function setBond(bytes32,uint256,bytes,uint256) returns (uint256)",
  "function getState(address,bytes32,uint256,bytes) view returns (uint8)",
  "function requesterWhitelist() view returns (address)",
  "function allowedBondRanges(address) view returns (uint128,uint128)",
];
const storeAbi = ["function computeFinalFee(address) view returns (tuple(uint256 rawValue))"];
const STORE = "0x799b0382Ef7C1b9457e52bDF2fCbc71B5eB083Aa";
// Raw bond per request (the allowedBondRange [1000,1500] constrains THIS
// value). Proposer's total = bond + finalFee(1) = 1001 — that is what the
// dapp displays as 保证金.
const BOND = ethers.utils.parseEther("1000");
const wlAbi = ["function isOnWhitelist(address) view returns (bool)"];
const erc20Abi = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const STATES = ["Invalid", "Requested", "Proposed", "Expired", "Disputed", "Resolved", "Settled"];

// All times in the partner's convention (UTC+8 / 北京时间).
const MATCHES = [
  {
    teamA: "墨西哥",
    abbrA: "MEX",
    teamB: "南非",
    abbrB: "RSA",
    matchDate: "2026-06-12",
    deadline: "2026-06-12 03:00 (UTC+8)",
  },
  {
    teamA: "加拿大",
    abbrA: "CAN",
    teamB: "波黑",
    abbrB: "BIH",
    matchDate: "2026-06-13",
    deadline: "2026-06-13 03:00 (UTC+8)",
  },
];

function rulesFor(m) {
  return [
    `${m.teamA} 与 ${m.teamB} 的比赛将于 ${m.matchDate} 进行。本话题涵盖该场比赛的胜负市场。`,
    "若比赛延期，市场将持续开放直至比赛完成。若比赛彻底取消且无补赛，队伍获胜市场结算为「否」，平局市场结算为「是」。市场仅涵盖正规赛 90 分钟及补时阶段内的比赛结果。",
    "首要结算来源为主管机构或赛事组织方认可的官方数据。若赛事结束后 2 小时内未公布最终比赛数据，则采用多方可信报道的综合结果作为替代依据。",
  ].join("\n\n");
}

function subMarkets(m) {
  return [`${m.teamA}获胜?`, "平局?", `${m.teamB}获胜?`];
}

function buildAncillary(m, subtitle, initializer) {
  return (
    `title: 2026 世界杯 · ${m.teamA}(${m.abbrA}) vs ${m.teamB}(${m.abbrB}) · ${subtitle}, ` +
    `description: ${rulesFor(m)}, ` +
    `deadline: ${m.deadline}, ` +
    "published: 2026-05-28 12:00, " +
    "source: https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup, " +
    "res_data: p1:0, p2:1, " +
    `initializer: ${initializer}`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) throw new Error(`mainnet-only (196). Connected to ${chainId}.`);
  const me = signer.address;
  const initializer = me.slice(2).toLowerCase();

  const moo = new ethers.Contract(MOOV2, mooAbi, signer);
  const xtr = new ethers.Contract(XTR, erc20Abi, signer);
  const addrWl = new ethers.Contract(ADDRESS_WHITELIST, wlAbi, signer);
  const baseTs = process.env.TS ? Number(process.env.TS) : Math.floor(Date.now() / 1000);

  console.log("signer:", me);
  if (!(await addrWl.isOnWhitelist(XTR))) throw new Error("XTR not on AddressWhitelist.");
  const reqWl = await moo.requesterWhitelist();
  if (!(await new ethers.Contract(reqWl, wlAbi, signer).isOnWhitelist(me)))
    throw new Error(`signer ${me} is NOT on the MOOv2 requester whitelist (${reqWl}).`);

  // Bond: requester setBond(BOND_TOTAL − finalFee) right after each request.
  // Preflight that the CONFIG_ADMIN has opened the allowedBondRange to cover it.
  const finalFee = (await new ethers.Contract(STORE, storeAbi, signer).computeFinalFee(XTR)).rawValue;
  const bond = BOND;
  const [rangeMin, rangeMax] = await moo.allowedBondRanges(XTR);
  console.log(
    `bond plan: bond ${ethers.utils.formatEther(bond)} + finalFee ${ethers.utils.formatEther(
      finalFee
    )} = 总保证金 ${ethers.utils.formatEther(bond.add(finalFee))}`
  );
  console.log(`allowedBondRange(XTR): ${ethers.utils.formatEther(rangeMin)} – ${ethers.utils.formatEther(rangeMax)}`);
  if (bond.lt(rangeMin) || bond.gt(rangeMax))
    throw new Error("bond outside allowedBondRange — set the range on /manager (MOOv2 tab) first.");

  const totalReward = REWARD.mul(MATCHES.length * 3);
  const bal = await xtr.balanceOf(me);
  if (bal.lt(totalReward))
    throw new Error(
      `XTR balance ${ethers.utils.formatEther(bal)} < needed reward ${ethers.utils.formatEther(totalReward)}`
    );
  if ((await xtr.allowance(me, MOOV2)).lt(totalReward)) {
    console.log("approve XTR → MOOv2 …");
    await (await xtr.approve(MOOV2, totalReward)).wait();
    await sleep(3000);
  }
  console.log("preflight ok. reward 2 XTR × 6 = 12 XTR\n");

  let k = 0;
  for (const m of MATCHES) {
    for (const subtitle of subMarkets(m)) {
      const ancillary = ethers.utils.toUtf8Bytes(buildAncillary(m, subtitle, initializer));
      const ts = baseTs + k++;
      console.log(`[${k}/${MATCHES.length * 3}] ${m.abbrA} vs ${m.abbrB} · ${subtitle}`);
      if ((await moo.getState(me, ASSERT_TRUTH, ts, ancillary)) !== 0) {
        console.log("   already exists — skipping\n");
        continue;
      }
      const tx = await moo.requestPrice(ASSERT_TRUTH, ts, ancillary, XTR, REWARD);
      await tx.wait();
      await sleep(3000);
      const txB = await moo.setBond(ASSERT_TRUTH, ts, ancillary, bond);
      await txB.wait();
      console.log(
        `   request ${tx.hash}\n   setBond ${txB.hash}  ts=${ts}  state=${
          STATES[await moo.getState(me, ASSERT_TRUTH, ts, ancillary)]
        }\n`
      );
      await sleep(3000);
    }
  }
  console.log(
    "done — 2 matches × 3 binary sub-markets on MAINNET, reward 2 XTR, bond 1000 XTR (总保证金 1001), no propose."
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
