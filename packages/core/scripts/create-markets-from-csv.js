// Create MOOv2 price requests from a PARTNER market CSV (OKX format), then emit
// a binding CSV (market_id ↔ entity_id) for xtruth-backend's import-markets.ts.
//
// This is the real integration tool: partner hands us a CSV → we create one
// on-chain MOOv2 request per market row, building ancillaryData from their
// fields → we capture each request's subgraph entity id and write the binding.
//
// Partner CSV columns (header row; extra columns ignored):
//   event_id            (required) partner event grouping
//   market_id           (required) partner market primary key (numeric string)
//   question            (required) market question → ancillary `title`
//   description         (optional) resolution rules → ancillary `description`
//   resolution_sources  (optional) → ancillary `source`
//   outcome             (optional) what this market's YES means (display)
//   deadline/published  (optional) → ancillary `deadline`/`published`
//
// Each market is a binary Yes/No request: res_data p1:0 (No), p2:1 (Yes).
//
// Run (testnet, with the .env key):
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app-dev.xtruth.xyz/api/rpc"
//   CSV=/tmp/partner.csv BIND_OUT=/tmp/binding.csv REWARD_XTR=2 \
//     yarn hardhat run scripts/create-markets-from-csv.js --network xlayer-testnet
//
// For mainnet, use --network xlayer + the mainnet MOOv2/XTR addresses (the
// script picks them by chainId) and run with a whitelisted mainnet key.
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;

const ASSERT_TRUTH = ethers.utils.formatBytes32String("ASSERT_TRUTH");

// Per-chain MOOv2 + XTR (+ AddressWhitelist) addresses.
const CHAINS = {
  1952: {
    moov2: "0x88f80d0cd78b8d014032c8862dce1b91662330d8",
    xtr: "0x44B706e1d8b6883677c7c92DC386d96c9B5650F3",
    addressWhitelist: "0xF2709Af88507cA0b08B28b042144E0481f820edb",
  },
  196: {
    moov2: "0xde9472548e9d92f019c86e243386a57c36d28ae1",
    xtr: "0x1819672530c65e1eF3a3f62fA8e6722655225a78",
    addressWhitelist: "0x278371F3aaC71669092Df46B4421c8b736f71f93",
  },
};

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

// Minimal RFC-4180 CSV parse (quoted fields, embedded commas/quotes/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length)) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.length)) rows.push(row);
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildAncillary(row, initializer) {
  const parts = [`title: ${row.question}`];
  if (row.description) parts.push(`description: ${row.description}`);
  if (row.deadline) parts.push(`deadline: ${row.deadline}`);
  if (row.published) parts.push(`published: ${row.published}`);
  if (row.resolution_sources) parts.push(`source: ${row.resolution_sources}`);
  parts.push("res_data: p1:0, p2:1"); // binary: p1=No, p2=Yes
  parts.push(`initializer: ${initializer}`);
  return parts.join(", ");
}

async function main() {
  const csvPath = process.env.CSV;
  const bindOut = process.env.BIND_OUT || "/tmp/binding.csv";
  const rewardXtr = process.env.REWARD_XTR || "2";
  if (!csvPath) throw new Error("set CSV=<partner csv path>");

  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`unsupported chainId ${chainId}`);
  const me = signer.address;
  const initializer = me.slice(2).toLowerCase();
  const REWARD = ethers.utils.parseEther(rewardXtr);

  const moo = new ethers.Contract(cfg.moov2, mooAbi, signer);
  const xtr = new ethers.Contract(cfg.xtr, erc20Abi, signer);

  // Parse CSV → rows of objects.
  const raw = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  const header = raw[0].map((h) => h.trim().toLowerCase());
  const idx = (n) => header.indexOf(n);
  const need = ["event_id", "market_id", "question"];
  for (const n of need) if (idx(n) < 0) throw new Error(`CSV missing column: ${n}`);
  const get = (r, n) => (idx(n) >= 0 ? (r[idx(n)] || "").trim() : "");
  const markets = raw
    .slice(1)
    .map((r) => ({
      event_id: get(r, "event_id"),
      market_id: get(r, "market_id"),
      question: get(r, "question"),
      description: get(r, "description"),
      resolution_sources: get(r, "resolution_sources"),
      outcome: get(r, "outcome"),
      deadline: get(r, "deadline"),
      published: get(r, "published"),
    }))
    .filter((m) => m.event_id && m.market_id && m.question);

  console.log(`signer: ${me} | chainId ${chainId} | ${markets.length} markets | reward ${rewardXtr} XTR each`);
  const reqWl = await moo.requesterWhitelist();
  if (!(await new ethers.Contract(reqWl, wlAbi, signer).isOnWhitelist(me)))
    throw new Error(`signer not on requester whitelist (${reqWl})`);

  const totalReward = REWARD.mul(markets.length);
  if ((await xtr.balanceOf(me)).lt(totalReward))
    throw new Error(`XTR balance < needed reward ${ethers.utils.formatEther(totalReward)}`);
  if (REWARD.gt(0) && (await xtr.allowance(me, cfg.moov2)).lt(totalReward)) {
    console.log("approve XTR → MOOv2 …");
    await (await xtr.approve(cfg.moov2, totalReward)).wait();
    await sleep(3000);
  }

  // entity id = <IDENTIFIER>-<time>-<keccak(ancillaryBytes)> (NO requester).
  const idOf = (ts, ancBytes) => `ASSERT_TRUTH-${ts}-${ethers.utils.keccak256(ancBytes)}`;

  const out = ["market_id,event_id,oracle,entity_id,title,outcome"];
  let baseTs = process.env.TS ? Number(process.env.TS) : Math.floor(Date.now() / 1000);
  let k = 0;
  for (const m of markets) {
    const ancBytes = ethers.utils.toUtf8Bytes(buildAncillary(m, initializer));
    const ts = baseTs + k++;
    process.stdout.write(`[${k}/${markets.length}] market ${m.market_id} (${m.event_id}) … `);
    if ((await moo.getState(me, ASSERT_TRUTH, ts, ancBytes)) !== 0) {
      console.log("exists, skip");
    } else {
      const tx = await moo.requestPrice(ASSERT_TRUTH, ts, ancBytes, cfg.xtr, REWARD);
      await tx.wait();
      console.log(`tx ${tx.hash.slice(0, 12)}… state=${STATES[await moo.getState(me, ASSERT_TRUTH, ts, ancBytes)]}`);
      await sleep(2500);
    }
    out.push(
      [m.market_id, m.event_id, "moov2", idOf(ts, ancBytes), `"${m.question.replace(/"/g, '""')}"`, m.outcome].join(",")
    );
  }
  fs.writeFileSync(bindOut, out.join("\n") + "\n");
  console.log(`\nbinding written → ${bindOut} (${markets.length} rows). Import with:`);
  console.log(`  pnpm api exec tsx scripts/import-markets.ts --csv ${bindOut} --chain ${chainId}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
