// Create World Cup match markets on X Layer TESTNET: per match, THREE
// independent binary (Yes/No) MOOv2 price requests (team A wins / draw /
// team B wins). reward = 2 XTR (requester pays, needs approval), DEFAULT bond
// (no requestManagerSetBond — the CustomBondSet path isn't indexed by the
// subgraph, so a custom bond wouldn't display anyway). No propose.
//
// Run:
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app-dev.xtruth.xyz/api/rpc"
//   yarn hardhat run scripts/create-worldcup-matches-testnet.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers } = hre;

const MOOV2 = "0x88f80d0cd78b8d014032c8862dce1b91662330d8";
const XTR = "0x44B706e1d8b6883677c7c92DC386d96c9B5650F3";
const ADDRESS_WHITELIST = "0xF2709Af88507cA0b08B28b042144E0481f820edb";
const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");
const REWARD = ethers.utils.parseEther("2"); // 2 XTR per request

const mooAbi = [
  "function requestPrice(bytes32,uint256,bytes,address,uint256) returns (uint256)",
  "function getState(address,bytes32,uint256,bytes) view returns (uint8)",
  "function requesterWhitelist() view returns (address)",
];
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

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 1952) throw new Error(`testnet-only (1952). Connected to ${chainId}.`);
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
    throw new Error("signer not on MOOv2 requester whitelist.");

  const totalReward = REWARD.mul(MATCHES.length * 3);
  const bal = await xtr.balanceOf(me);
  if (bal.lt(totalReward))
    throw new Error(
      `XTR balance ${ethers.utils.formatEther(bal)} < needed reward ${ethers.utils.formatEther(totalReward)}`
    );
  if ((await xtr.allowance(me, MOOV2)).lt(totalReward)) {
    console.log("approve XTR → MOOv2 …");
    await (await xtr.approve(MOOV2, ethers.constants.MaxUint256)).wait();
  }
  console.log("preflight ok. reward per request: 2 XTR, total:", ethers.utils.formatEther(totalReward), "XTR\n");

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
      console.log(`   tx ${tx.hash}  ts=${ts}  state=${STATES[await moo.getState(me, ASSERT_TRUTH, ts, ancillary)]}\n`);
    }
  }
  console.log("done — 2 matches × 3 binary sub-markets, reward 2 XTR, default bond, no propose.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
