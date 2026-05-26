# X Layer Testnet — Canonical UMA Deployment

Self-hosted, canonical (un-forked) UMA DVM 2.0 + Optimistic Oracles on **X Layer
testnet** for the **xtruth** project. This replaces the earlier WOKB-based fork.

|                      |                                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Network              | X Layer testnet                                                    |
| chainId              | **1952**                                                           |
| Deployed             | 2026-05-20 (faucet/MOOv2 2026-05-21)                               |
| Deployer / owner EOA | `0xfAf4189886b525782bf3DD4e830f5c569BC095A1`                       |
| Source               | protocol `feat/xlayer-deploy` (branched from canonical UMA master) |
| Explorer             | https://www.okx.com/xlayer/testnet/explorer                        |
| RPC (app proxy)      | https://app.xtruth.xyz/api/rpc                                     |

> Verify on-chain bytecode is canonical UMA (not fork) any time with
> `node scripts/verify-canonical-onchain.js`.

---

## Core DVM contracts

| Contract                  | Address                                      | Deploy block |
| ------------------------- | -------------------------------------------- | ------------ |
| Finder                    | `0x290453F12fF8fA1f2530f2544C6c58F4C40F556C` | 30790357     |
| Registry                  | `0x10c01D10a7b81De1f36096cdB4085d7195f046CB` | 30790341     |
| Store                     | `0x96ca64628c83D61eDD3384d6aA362d233ed70245` | 30790349     |
| IdentifierWhitelist       | `0xC322cbcE4501C9a6d643f37Fd543F2551cDF46CC` | 30790345     |
| AddressWhitelist          | `0xF2709Af88507cA0b08B28b042144E0481f820edb` | 30790353     |
| VotingToken (XTR)         | `0x44B706e1d8b6883677c7c92DC386d96c9B5650F3` | 30790376     |
| VotingV2 (DVM)            | `0xAB332A31bFA83f24CF5415f8443C32C6F7788a9E` | 30790396     |
| FixedSlashSlashingLibrary | `0xa9CE93Fd08317dc565262EDefcb086F402066b84` | —            |

## Governance

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| GovernorV2                | `0xC0bD02a296155Edf0e75666AC85708754D9cb86e` |
| ProposerV2                | `0x19C7aB4B5CCF02dE32D3C1d241b828f41DF77957` |
| EmergencyProposer         | `0xfa48a5c042941aA5bB99DF75c3f3081EB9b1DbEc` |
| DesignatedVotingV2Factory | `0x1872901f7F8c14ebCD519aa35c9F94d808734d35` |

## Optimistic Oracles

| Contract                                    | Address                                      | Deploy block        |
| ------------------------------------------- | -------------------------------------------- | ------------------- |
| OptimisticOracle (V1)                       | `0xdC7aEbe014eb9c3edAeA9796d2f48a72e90ECE12` | 30790362            |
| OptimisticOracleV2                          | `0xeF3e851F7BdfaC5491B562b90D8bc5209524a7C2` | 30790372            |
| OptimisticOracleV3                          | `0xa6d5B5b1e71AC1D12041997b9583CDb3A5DC5b1b` | 30790776            |
| SkinnyOptimisticOracle                      | `0xDe85590Fc9782f430CFBe6F5fD9a52C44877596B` | 30790367            |
| SkinnyOptimisticOracleV2                    | `0x72b559e0aC3c783D9AC09e8e54405f3bcF2227e9` | 30790424            |
| **ManagedOptimisticOracleV2 (MOOv2)** proxy | `0x88f80d0cd78b8d014032c8862dce1b91662330d8` | ~30790xxx           |
| MOOv2 implementation                        | `0x069D2fb28B575604c81dCC46a2cD0341baF80862` | (behind UUPS proxy) |
| MOOv2 proposer+requester whitelist          | `0x983ac45b12F06d34D8131A1C12555608E1A857c6` | —                   |

## Test / tooling

| Contract                 | Address                                      |
| ------------------------ | -------------------------------------------- |
| XtrFaucet (testnet only) | `0xD84bB1e0CB4bE75E20C05f56D06E415Accb18bc8` |

---

## Parameters (live on-chain)

### VotingToken (XTR)

- name / symbol / decimals: **Xtruth Token / XTR / 18**
- mintable `ExpandedERC20`; Owner = deployer; Minter = deployer + XtrFaucet; Burner = deployer

### VotingV2 (DVM)

| Param                | Value                                               |
| -------------------- | --------------------------------------------------- |
| votingToken          | XTR `0x44B706…`                                     |
| emissionRate         | **0.1 XTR/s** (1e17)                                |
| gat (quorum)         | **1 XTR** (1e18)                                    |
| spat (supermajority) | **0.5 (50%)** (5e17)                                |
| unstakeCoolDown      | **60 s** (testnet)                                  |
| phaseLength          | **900 s** (commit / reveal each)                    |
| maxRolls             | **144**                                             |
| maxRequestsPerRound  | **1000**                                            |
| owner                | **GovernorV2** `0xC0bD02…` (governance, not an EOA) |

> VoterStake is the standard **8-field** struct WITH emission. No `adminSlash`
> / `executeUnstakeAsNative` (those were fork-only).

### OptimisticOracleV3

| Param                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| defaultCurrency      | **WOKB** `0x4200…0006`                                                           |
| defaultLiveness      | **7200 s** (2h)                                                                  |
| burnedBondPercentage | **0.5 (50%)**                                                                    |
| defaultIdentifier    | **ASSERT_TRUTH** (whitelisted)                                                   |
| owner                | deployer EOA `0xfAf4…`                                                           |
| getMinimumBond       | `finalFee / burnedBondPercentage` = **2× finalFee** → WOKB 0.0002, USDC_TEST 0.2 |

### Store — final fees (bond currencies)

| Currency  | Address                                      | decimals | finalFee          |
| --------- | -------------------------------------------- | -------- | ----------------- |
| WOKB      | `0x4200000000000000000000000000000000000006` | 18       | **0.0001** (1e14) |
| USDC_TEST | `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` | 6        | **0.1** (1e5)     |

Both are on the AddressWhitelist and synced into OOv3 (`syncUmaParams`).

### ManagedOptimisticOracleV2 (MOOv2)

| Param               | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| finder              | canonical `0x290453…`                                                        |
| defaultLiveness     | **7200 s**                                                                   |
| proposer whitelist  | `0x983ac4…` (**currently EMPTY** → no one authorized to propose/request yet) |
| requester whitelist | `0x983ac4…` (same contract)                                                  |

> MOOv2 = OOv2 + proposer/requester whitelist + per-request bond/liveness, UUPS
> proxy. Code is **UMA original** (managed-oracle repo), no fork logic.

### XtrFaucet (testnet)

| Param      | Value                       |
| ---------- | --------------------------- |
| token      | XTR                         |
| dripAmount | **1000 XTR** per call       |
| cooldown   | **3600 s** (1h) per address |

---

## Subgraphs (self-hosted graph-node, `https://subgraph.xtruth.xyz`)

| Oracle / source | Endpoint (name)                                      |
| --------------- | ---------------------------------------------------- |
| OOv1            | `xtruth/xlayer-testnet-optimistic-oracle`            |
| OOv2            | `xtruth/xlayer-testnet-optimistic-oracle-v2`         |
| OOv3            | `xtruth/xlayer-testnet-optimistic-oracle-v3`         |
| Skinny          | `xtruth/xlayer-testnet-skinny-oo`                    |
| MOOv2           | `xtruth/xlayer-testnet-managed-optimistic-oracle-v2` |
| VotingV2 (DVM)  | `xtruth/xlayer-testnet-voting-v2`                    |

> votingV2 + MOOv2 subgraphs start near chain head (≈30977000) to avoid a
> chain-store block-hash mismatch in the historical range (see CLAUDE.md). No
> usable history is lost (no votes/MOOv2 requests yet).

---

## Ownership split (matters for admin actions)

- **VotingV2** owner = **GovernorV2** (a contract) → DVM params are governance-controlled, not EOA.
- **IdentifierWhitelist / OOv3 / VotingToken / AddressWhitelist** owner = **deployer EOA**.
- **XTR roles**: Owner = deployer; Minter = deployer + XtrFaucet; Burner = deployer.

## Post-deploy setup that is required (run once after a fresh deploy)

1. `setup-dvmv2` ×2 — register contracts, whitelists, etc.
2. `scripts/setup-oov3-collateral.js` — whitelist WOKB + USDC_TEST + set Store finalFees.
3. `scripts/setup-oov3-identifier.js` — add `ASSERT_TRUTH` to IdentifierWhitelist + `syncUmaParams` (else `assertTruth` reverts "Unsupported identifier").
4. `scripts/deploy-xtr-faucet.js` — deploy faucet + `addMinter`.
5. `scripts/setup-token-admin.js` (optional) — grant a token-admin EOA Minter+Burner.
6. (MOOv2) add proposer/requester addresses to whitelist `0x983ac4…` before it can be used.

E2E regression: `scripts/e2e-canonical.js`. Bytecode check: `scripts/verify-canonical-onchain.js`.
