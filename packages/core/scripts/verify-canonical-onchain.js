// Verify the DEPLOYED bytecode on X Layer testnet is the ORIGINAL UMA logic
// (not the old WOKB fork). We don't trust docs — we inspect the runtime
// bytecode at each canonical address for fork-only vs original-UMA function
// selectors. A fork-only selector PRESENT, or an original-UMA selector
// ABSENT, means the chain is NOT canonical and a redeploy is needed.
//
// Run:
//   node scripts/verify-canonical-onchain.js
//   RPC_URL=https://... node scripts/verify-canonical-onchain.js
const { ethers } = require("ethers");

const RPC = process.env.RPC_URL || process.env.NODE_URL_1952 || "https://app.xtruth.xyz/api/rpc";

// Canonical xlayer-testnet addresses (2026-05-20 deploy).
const A = {
  VotingV2: "0xAB332A31bFA83f24CF5415f8443C32C6F7788a9E",
  OptimisticOracleV3: "0xa6d5B5b1e71AC1D12041997b9583CDb3A5DC5b1b",
};

const sel = (sig) => ethers.utils.id(sig).slice(2, 10);

// For each contract: selectors that MUST be absent (fork-only) and MUST be
// present (original UMA). expect=false → fork marker (should be absent).
const CHECKS = {
  VotingV2: {
    addr: A.VotingV2,
    sels: [
      ["adminSlash(address,address,uint128,bytes32)", false, "fork-only"],
      ["executeUnstakeAsNative()", false, "fork-only"],
      ["setEmissionRate(uint128)", true, "original UMA"],
      ["emissionRate()", true, "original UMA"],
      ["withdrawRewards()", true, "original UMA"],
    ],
  },
  OptimisticOracleV3: {
    addr: A.OptimisticOracleV3,
    sels: [
      ["adminSettleAssertion(bytes32)", false, "fork patch"],
      ["assertTruth(bytes,address,address,address,uint64,address,uint256,bytes32,bytes32)", true, "original UMA"],
      ["syncUmaParams(bytes32,address)", true, "original UMA"],
    ],
  },
};

async function main() {
  const p = new ethers.providers.JsonRpcProvider(RPC);
  console.log("RPC:", RPC, "\n");
  let bad = 0;
  for (const [name, { addr, sels }] of Object.entries(CHECKS)) {
    const code = (await p.getCode(addr)).toLowerCase();
    if (code === "0x") {
      console.log(`✗ ${name} (${addr}): NO CODE`);
      bad++;
      continue;
    }
    console.log(`=== ${name} (${addr}) codeSize=${(code.length - 2) / 2} ===`);
    for (const [sig, expectPresent, note] of sels) {
      const present = code.includes(sel(sig));
      const ok = present === expectPresent;
      if (!ok) bad++;
      console.log(
        `  ${ok ? "✓" : "✗ MISMATCH"}  ${present ? "PRESENT" : "absent "}  ${sig}  (${note}, expect ${
          expectPresent ? "present" : "absent"
        })`
      );
    }
  }
  console.log(
    bad === 0
      ? "\n✓ All canonical — deployed bytecode is original UMA"
      : `\n✗ ${bad} mismatch(es) — chain is NOT fully canonical`
  );
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
