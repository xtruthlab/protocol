/* eslint-disable no-console */
// Propagate deployed contract addresses → frontend (xtruth-app) + subgraphs.
// Reads hardhat-deploy artifacts (packages/core/deployments/<network>/*.json,
// each has .address + .receipt.blockNumber) and writes:
//   1. xtruth-app/src/lib/contracts/addresses.ts → CONTRACTS[<chainId>] block
//   2. subgraphs/packages/<pkg>/manifest/data/<subgraphNetwork>.json
//      → DataSources address+startBlock (+ votingV2 named whitelist/token addrs)
//
// MOOv2 is forge-deployed (not in hardhat deployments) — pass MOOV2_ADDRESS
// (and optional MOOV2_BLOCK) via env.
//
// Repo locations: by default xtruth-app + subgraphs are assumed to be SIBLINGS
// of the protocol repo. Different layout (e.g. someone else's clone)? Override:
//   XTRUTH_APP_DIR=/abs/path/to/xtruth-app  SUBGRAPHS_DIR=/abs/path/to/subgraphs
// A repo that's absent is skipped with a warning, never a crash.
//
// Run (validate against the existing testnet, no writes):
//   node scripts/sync-deployed-addresses.js --network xlayer-testnet \
//     --chain-id 1952 --subgraph-network xlayer-testnet --dry-run
// After a mainnet deploy (custom layout shown):
//   XTRUTH_APP_DIR=~/code/xtruth-app SUBGRAPHS_DIR=~/code/subgraphs \
//   MOOV2_ADDRESS=0x.. MOOV2_BLOCK=12345 node scripts/sync-deployed-addresses.js \
//     --network xlayer-mainnet --chain-id 196 --subgraph-network xlayer-mainnet
const fs = require("fs");
const path = require("path");

// Cross-repo output locations. The DEFAULT layout assumes xtruth-app and
// subgraphs are checked out as SIBLINGS of the protocol repo (the dev setup):
//   <parent>/protocol, <parent>/xtruth-app, <parent>/subgraphs
// Any other layout: point at the repo roots explicitly via env —
//   XTRUTH_APP_DIR=/path/to/xtruth-app  SUBGRAPHS_DIR=/path/to/subgraphs
// A repo that isn't present is skipped with a warning (not a hard error), so
// you can sync just the app, just the subgraphs, or neither.
const SIBLINGS = path.resolve(__dirname, "../../../.."); // parent of the protocol repo
const APP_DIR = process.env.XTRUTH_APP_DIR || path.join(SIBLINGS, "xtruth-app");
const SG_DIR = process.env.SUBGRAPHS_DIR || path.join(SIBLINGS, "subgraphs");
const APP_ADDR = path.join(APP_DIR, "src/lib/contracts/addresses.ts");
const SG = path.join(SG_DIR, "packages");
const DEPLOY = (network) => path.resolve(__dirname, "..", "deployments", network);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const DRY = process.argv.includes("--dry-run");

// hardhat-deploy artifact name → app CONTRACTS key.
const APP_KEYS = {
  Finder: "finder",
  Registry: "registry",
  Store: "store",
  VotingToken: "votingToken",
  VotingV2: "votingV2",
  IdentifierWhitelist: "identifierWhitelist",
  AddressWhitelist: "addressWhitelist",
  FixedSlashSlashingLibrary: "slashingLibrary",
  GovernorV2: "governorV2",
  ProposerV2: "proposerV2",
  EmergencyProposer: "emergencyProposer",
  DesignatedVotingV2Factory: "designatedVotingV2Factory",
  OptimisticOracle: "optimisticOracle",
  OptimisticOracleV2: "optimisticOracleV2",
  OptimisticOracleV3: "optimisticOracleV3",
  SkinnyOptimisticOracle: "skinnyOptimisticOracle",
  SkinnyOptimisticOracleV2: "skinnyOptimisticOracleV2",
};
// App keys forced to zero on mainnet (testnet-only / not deployed).
const ZERO_KEYS = ["assertWithOkb", "stakeWithOkb", "mockOracleAncillary", "xtrFaucet"];

// subgraph package → main DataSources key + contract artifact name.
const SG_MAP = {
  "optimistic-oracle": ["OptimisticOracleDataSources", "OptimisticOracle"],
  "optimistic-oracle-v2": ["OptimisticOracleV2DataSources", "OptimisticOracleV2"],
  "optimistic-oracle-v3": ["OptimisticOracleV3DataSources", "OptimisticOracleV3"],
  "skinny-optimistic-oracle": ["SkinnyOptimisticOracleDataSources", "SkinnyOptimisticOracle"],
  "managed-oracle-v2": ["ManagedOracleV2DataSources", "ManagedOptimisticOracleV2"],
  votingV2: ["VotingDataSources", "VotingV2"],
};

function loadArtifacts(network) {
  const dir = DEPLOY(network);
  if (!fs.existsSync(dir)) throw new Error("no deployments dir: " + dir);
  const map = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const name = f.replace(/\.json$/, "");
    try {
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (a.address) map[name] = { address: a.address, block: a.receipt?.blockNumber ?? 0 };
    } catch {
      /* skip non-artifact json (solcInputs etc.) */
    }
  }
  // MOOv2 from env (forge-deployed).
  if (process.env.MOOV2_ADDRESS) {
    map.ManagedOptimisticOracleV2 = { address: process.env.MOOV2_ADDRESS, block: Number(process.env.MOOV2_BLOCK ?? 0) };
  }
  return map;
}

function genAppBlock(chainId, art) {
  const q = (n) => (art[n]?.address ? `"${art[n].address}"` : "Z");
  const vv2Block = art.VotingV2?.block ?? 0;
  const lines = [`  ${chainId}: {`];
  for (const [name, key] of Object.entries(APP_KEYS)) lines.push(`    ${key}: ${q(name)},`);
  // MOOv2 is forge-deployed (env MOOV2_ADDRESS, stored as ManagedOptimisticOracleV2);
  // emit it explicitly since it's not a hardhat artifact in APP_KEYS.
  lines.push(`    managedOptimisticOracleV2: ${q("ManagedOptimisticOracleV2")},`);
  for (const k of ZERO_KEYS) lines.push(`    ${k}: Z,`);
  lines.push(`    votingV2DeployBlock: ${vv2Block}n,`);
  lines.push("    botAddresses: [...envBotAddresses()],");
  lines.push("  },");
  return lines.join("\n");
}

function writeApp(chainId, art) {
  if (!fs.existsSync(APP_ADDR)) {
    console.log(
      `  skip app: not found at ${APP_ADDR}\n    (set XTRUTH_APP_DIR to the xtruth-app repo root if it's checked out elsewhere)`
    );
    return;
  }
  let src = fs.readFileSync(APP_ADDR, "utf8");
  const block = genAppBlock(chainId, art);
  // Replace the existing `  <chainId>: { ... },` block (greedy to its closing).
  const re = new RegExp(`\\n  ${chainId}: \\{[\\s\\S]*?\\n  \\},`);
  if (!re.test(src)) throw new Error(`CONTRACTS[${chainId}] block not found in addresses.ts`);
  src = src.replace(re, "\n" + block);
  if (DRY) {
    console.log(`\n[app CONTRACTS[${chainId}]] would write:\n${block}`);
    return;
  }
  fs.writeFileSync(APP_ADDR, src);
  console.log(`✓ app CONTRACTS[${chainId}] updated`);
}

function writeSubgraphs(sgNet, art) {
  if (!fs.existsSync(SG)) {
    console.log(
      `  skip subgraphs: not found at ${SG}\n    (set SUBGRAPHS_DIR to the subgraphs repo root if it's checked out elsewhere)`
    );
    return;
  }
  for (const [pkg, [dsKey, contract]] of Object.entries(SG_MAP)) {
    const file = path.join(SG, pkg, "manifest/data", `${sgNet}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  skip ${pkg} (no ${sgNet}.json)`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const c = art[contract];
    if (c && Array.isArray(d[dsKey])) {
      for (const ds of d[dsKey]) {
        ds.address = c.address;
        ds.startBlock = c.block;
      }
    }
    // votingV2 named whitelist/token addresses + start blocks.
    if (pkg === "votingV2") {
      const named = {
        votingToken: "VotingToken",
        identifierWhitelist: "IdentifierWhitelist",
        registry: "Registry",
        addressWhitelist: "AddressWhitelist",
      };
      for (const [pfx, name] of Object.entries(named)) {
        const x = art[name];
        if (!x) continue;
        d[`${pfx}Address`] = x.address;
        d[`${pfx}StartBlock`] = x.block;
      }
    }
    if (DRY) {
      console.log(
        `\n[subgraph ${pkg}/${sgNet}.json] ${contract} -> ${art[contract]?.address ?? "MISSING"} @${
          art[contract]?.block ?? "?"
        }`
      );
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
    console.log(`✓ subgraph ${pkg}/${sgNet}.json updated`);
  }
}

function main() {
  const network = arg("network", "xlayer-mainnet");
  const chainId = arg("chain-id", "196");
  const sgNet = arg("subgraph-network", network);
  // Safety: write-mode against testnet (1952) would force xtrFaucet / MOOv2 /
  // mockOracle to Z (they're genuinely zero only on mainnet). Refuse unless
  // --force is given — the testnet block is hand-maintained and live.
  if (!DRY && String(chainId) === "1952" && !process.argv.includes("--force")) {
    throw new Error(
      "Refusing to overwrite testnet CONTRACTS[1952] in write mode (would zero xtrFaucet/mockOracle).\n" +
        "  Use --dry-run to validate the extraction, or --force to override intentionally."
    );
  }
  console.log(
    `sync from deployments/${network} → app CONTRACTS[${chainId}] + subgraphs/${sgNet}.json${DRY ? "  (DRY RUN)" : ""}`
  );
  const art = loadArtifacts(network);
  const found = Object.keys(APP_KEYS).filter((n) => art[n]);
  console.log(
    `artifacts found: ${found.length}/${Object.keys(APP_KEYS).length}  MOOv2=${
      art.ManagedOptimisticOracleV2 ? art.ManagedOptimisticOracleV2.address : "(set MOOV2_ADDRESS)"
    }`
  );
  writeApp(chainId, art);
  writeSubgraphs(sgNet, art);
}

main();
