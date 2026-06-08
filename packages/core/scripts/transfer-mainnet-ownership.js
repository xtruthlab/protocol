// ⚠️⚠️  CRITICAL, LARGELY IRREVERSIBLE  ⚠️⚠️
// Transfers owner / admin of the ENTIRE X Layer mainnet (196) UMA stack to:
//   NEW = 0x2219B22b37d18E64D2878a294bA290c62407cEa6
//
// If NEW is wrong (typo / not a contract you control / key lost), control of
// the whole protocol is GONE — no one can change params, mint XTR, manage
// whitelists, etc. STRONGLY recommended: NEW should be a multisig, and you
// should test ONE low-stakes contract first (comment out the rest, run, verify
// the new owner can act), before transferring VotingV2 / Store / VotingToken.
//
// TWO KEYS NEEDED — the script branches on the signer:
//   • Run with the deployer EOA  0x1F53…0B80  → transfers everything it owns.
//   • Run with                   0x6EFa…416A  → transfers the StakingRewardsVault
//     (its DEFAULT_ADMIN + DISTRIBUTOR are held by 0x6EFa, not the EOA).
//
// NOT handled (by design / impossible from these keys):
//   • ProposerV2 / EmergencyProposer — owned by GovernorV2; they follow once
//     GovernorV2's owner becomes NEW (governance executes any change).
//   • SlashingLibrary / DesignatedVotingV2Factory / OOv1 / OOv2 / Skinny(V2) —
//     no owner to transfer.
//
// Idempotent: every step checks current state and skips if already NEW.
// Per-contract try/catch: one failure logs + continues, doesn't abort the rest.
//
// Run:
//   cd packages/core
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   yarn hardhat run scripts/transfer-mainnet-ownership.js --network xlayer
const hre = require("hardhat");
const { ethers } = hre;

const NEW = "0x2219B22b37d18E64D2878a294bA290c62407cEa6";
const EOA = "0x1F53Be6BDe296C20393d71Eb20233Faae3480B80"; // current owner of most
const SIX = "0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A"; // StakingRewardsVault admin

// Move operational (non-owner) roles too, so the OLD key retains nothing.
// ⚠️ If false: the EOA KEEPS VotingToken Minter (can still mint XTR), Store
// Withdrawer, Registry Creator — and after the Owner transfer it can't even
// remove them (only NEW can). Keep true for a clean handover.
const MOVE_OPERATIONAL_ROLES = true;

const A = {
  finder: "0x5003C68a91b58be8eF9babbA5a623dA98109B088",
  registry: "0xd21E2D7E7B6Ef31bbfE1793692466b0B2043a842",
  store: "0x799b0382Ef7C1b9457e52bDF2fCbc71B5eB083Aa",
  votingToken: "0x1819672530c65e1eF3a3f62fA8e6722655225a78",
  votingV2: "0x382Fa88A4c0a340e89F96Fc54C2282B8Ad4BA000",
  identifierWhitelist: "0x2E651F03d658aE9a3796A2cc4b67C6E6dfe2ae44",
  addressWhitelist: "0x278371F3aaC71669092Df46B4421c8b736f71f93",
  governorV2: "0x82E6dcb12E029CeA2FF2486A07aE48a4cdfc28ff",
  optimisticOracleV3: "0xAC238D4B79b112264a46fC46538D595fD43f73c8",
  managedOOv2: "0xde9472548e9d92f019c86e243386a57c36d28ae1",
  moov2Whitelist: "0xDEEa77AC6c2356Df9A6f57802EB68b4B2C5C1AAC",
  stakingRewardsVault: "0x9725c512F108923BB8aC8855580073542cfC187b",
};

const ownableAbi = ["function owner() view returns (address)", "function transferOwnership(address) external"];
const multiRoleAbi = [
  "function getMember(uint256) view returns (address)",
  "function holdsRole(uint256,address) view returns (bool)",
  "function resetMember(uint256,address) external",
  "function addMember(uint256,address) external",
  "function removeMember(uint256,address) external",
];
const accessAbi = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function CONFIG_ADMIN_ROLE() view returns (bytes32)",
  "function DISTRIBUTOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address) external",
  "function revokeRole(bytes32,address) external",
];

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`   ✗ ${label} FAILED: ${(e.reason || e.message).slice(0, 120)}`);
  }
}

async function transferOwnable(signer, name, addr) {
  const c = new ethers.Contract(addr, ownableAbi, signer);
  await step(`${name}.transferOwnership`, async () => {
    const cur = await c.owner();
    if (eq(cur, NEW)) return console.log(`[owner] ${name} already NEW ✓`);
    if (!eq(cur, signer.address)) return console.log(`   ⚠ ${name}.owner=${cur}, not signer — skipped`);
    console.log(`[owner] ${name}.transferOwnership(NEW)`);
    await (await c.transferOwnership(NEW)).wait();
  });
}

// MultiRole: move shared/exclusive sub-roles FIRST, then the Owner (role 0)
// LAST — once Owner moves to NEW, the EOA can no longer manage sub-roles.
async function transferMultiRole(signer, name, addr, subRoles) {
  const c = new ethers.Contract(addr, multiRoleAbi, signer);
  if (MOVE_OPERATIONAL_ROLES) {
    for (const r of subRoles) {
      await step(`${name} role#${r.id} (${r.label})`, async () => {
        if (r.exclusive) {
          const m = await c.getMember(r.id);
          if (eq(m, NEW)) return console.log(`[role] ${name} ${r.label} already NEW ✓`);
          console.log(`[role] ${name}.resetMember(${r.id} ${r.label}, NEW)`);
          await (await c.resetMember(r.id, NEW)).wait();
        } else {
          if (!(await c.holdsRole(r.id, NEW))) {
            console.log(`[role] ${name}.addMember(${r.id} ${r.label}, NEW)`);
            await (await c.addMember(r.id, NEW)).wait();
          }
          if (await c.holdsRole(r.id, EOA)) {
            console.log(`[role] ${name}.removeMember(${r.id} ${r.label}, EOA)`);
            await (await c.removeMember(r.id, EOA)).wait();
          }
        }
      });
    }
  }
  await step(`${name} Owner(0)`, async () => {
    const m = await c.getMember(0);
    if (eq(m, NEW)) return console.log(`[owner] ${name} Owner already NEW ✓`);
    if (!eq(m, signer.address)) return console.log(`   ⚠ ${name} Owner=${m}, not signer — skipped`);
    console.log(`[owner] ${name}.resetMember(0 Owner, NEW)  ← LAST`);
    await (await c.resetMember(0, NEW)).wait();
  });
}

async function transferAccessControl(signer, name, addr, extraRoleNames) {
  const c = new ethers.Contract(addr, accessAbi, signer);
  const ADMIN = await c.DEFAULT_ADMIN_ROLE();
  const roles = [{ n: "DEFAULT_ADMIN_ROLE", id: ADMIN }];
  for (const rn of extraRoleNames) roles.push({ n: rn, id: await c[rn]() });
  // grant NEW everything first
  for (const r of roles) {
    await step(`${name} grant ${r.n}`, async () => {
      if (await c.hasRole(r.id, NEW)) return console.log(`[acl] ${name} ${r.n} NEW already ✓`);
      console.log(`[acl] ${name}.grantRole(${r.n}, NEW)`);
      await (await c.grantRole(r.id, NEW)).wait();
    });
  }
  // then revoke signer's roles (admin role revoked LAST)
  for (const r of [...roles].reverse()) {
    await step(`${name} revoke ${r.n}`, async () => {
      if (!(await c.hasRole(r.id, signer.address))) return;
      console.log(`[acl] ${name}.revokeRole(${r.n}, signer)`);
      await (await c.revokeRole(r.id, signer.address)).wait();
    });
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 196) throw new Error(`mainnet-only (196). Connected to ${chainId}.`);
  console.log("signer    :", signer.address);
  console.log("new owner :", NEW);
  if (eq(signer.address, NEW)) throw new Error("signer == NEW; nothing to transfer from.");

  if (eq(signer.address, EOA)) {
    console.log("\n=== Branch: deployer EOA — transferring the main stack ===");
    // Ownable
    await transferOwnable(signer, "finder", A.finder);
    await transferOwnable(signer, "votingV2", A.votingV2);
    await transferOwnable(signer, "identifierWhitelist", A.identifierWhitelist);
    await transferOwnable(signer, "addressWhitelist", A.addressWhitelist);
    await transferOwnable(signer, "optimisticOracleV3", A.optimisticOracleV3);
    await transferOwnable(signer, "moov2Whitelist", A.moov2Whitelist);
    await transferOwnable(signer, "managedOOv2(owner)", A.managedOOv2);
    // MultiRole (sub-roles then Owner)
    await transferMultiRole(signer, "registry", A.registry, [{ id: 1, label: "Creator", exclusive: false }]);
    await transferMultiRole(signer, "store", A.store, [{ id: 1, label: "Withdrawer", exclusive: true }]);
    await transferMultiRole(signer, "votingToken", A.votingToken, [
      { id: 1, label: "Minter", exclusive: false },
      // Burner (role 2) — EOA doesn't hold it; nothing to move.
    ]);
    await transferMultiRole(signer, "governorV2", A.governorV2, []);
    // MOOv2 AccessControl (DEFAULT_ADMIN + CONFIG_ADMIN)
    await transferAccessControl(signer, "managedOOv2(acl)", A.managedOOv2, ["CONFIG_ADMIN_ROLE"]);
  } else if (eq(signer.address, SIX)) {
    console.log("\n=== Branch: 0x6EFa — transferring StakingRewardsVault ===");
    await transferAccessControl(signer, "stakingRewardsVault", A.stakingRewardsVault, ["DISTRIBUTOR_ROLE"]);
  } else {
    throw new Error(`signer ${signer.address} is neither the EOA (${EOA}) nor the vault admin (${SIX}).`);
  }

  console.log("\n✓ Done for this signer. Re-run with the other key for the rest.");
  console.log("  Verify with: scripts/audit-mainnet-ownership (read-only).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
