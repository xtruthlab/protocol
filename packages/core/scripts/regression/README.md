# Regression-testing ownership shims

This directory holds **testing-only** scripts that temporarily mutate the
canonical UMA governance topology on X Layer mainnet (chainId 196) to make
on-chain regression tests practical.

## Why it exists

On a freshly bootstrapped DVM the canonical governance loop is unusable:

- `cumulativeStake = 0` and `gat = 5,000,000 XTR` → no DVM vote can ever
  reach quorum.
- `EmergencyProposer` contract has a 10-day `minimumWaitTime`.
- `unstakeCoolDown = 7 days`.

Iterating on the dApp would take weeks per tweak. So during the regression
window we:

1. Briefly seize the `EmergencyProposer` role on GovernorV2 (the deployer EOA
   holds GovernorV2.Owner, which manages role 2).
2. Use `emergencyExecute` to transfer `VotingV2.owner` from GovernorV2 to
   the deployer EOA.
3. Return the `EmergencyProposer` role to its original contract.

Net result: **only one piece of state moves** — `VotingV2.owner`. Everything
else is left untouched.

## Audit trail

`ownership-snapshot.json` records every privileged role on every canonical
contract on mainnet (chainId 196) **before** any swap. It's the source of
truth for "what should this role hold once regression is done." Read it
before touching anything.

The single role that the swap mutates:

| Contract | Role  | Canonical holder                | During regression                 |
| -------- | ----- | ------------------------------- | --------------------------------- |
| VotingV2 | owner | `GovernorV2` (`0x82E6dc..28ff`) | `deployer EOA` (`0x1F53Be..0B80`) |

(`GovernorV2.Roles.EmergencyProposer` is transiently held by the deployer
inside `swap-owner-to-eoa.js` — but the swap script restores it before
exiting, so post-swap the only divergence from `ownership-snapshot.json` is
the VotingV2.owner line.)

## Scripts

### `swap-owner-to-eoa.js`

Three-tx atomic swap: take EmergencyProposer → emergencyExecute(transferOwnership(deployer)) → restore EmergencyProposer. Idempotent.

```bash
cd packages/core
yarn hardhat run scripts/regression/swap-owner-to-eoa.js --network xlayer
```

### `lower-vote-thresholds.js`

Once VotingV2.owner = deployer EOA, this calls `setGatAndSpat(1 XTR, 0.5e18)` and `setUnstakeCoolDown(60)` directly. Idempotent (skips fields already at target).

```bash
yarn hardhat run scripts/regression/lower-vote-thresholds.js --network xlayer
```

### `restore-owner-to-governor.js`

Single tx: `VotingV2.transferOwnership(GovernorV2)`. Idempotent.

```bash
yarn hardhat run scripts/regression/restore-owner-to-governor.js --network xlayer
```

## Pre-prod checklist (when regression is over)

Before opening real markets / accepting real value:

- [ ] Raise gat back to a production value (e.g. 5,000,000 XTR or whatever
      proportion of staked XTR you want as quorum) — direct call while EOA
      still holds owner, OR submit as the first real DVM proposal after
      restore.
- [ ] Raise unstakeCoolDown back to 604800 (7 days).
- [ ] Raise OOv3 finalFee from 0.000001 USDC back to production level
      (UMA-aligned is 250 USDC). Use `setup-oov3-collateral.js`.
- [ ] Run `restore-owner-to-governor.js` — this is the last step. Once
      VotingV2.owner = GovernorV2 again, all further changes go through DVM
      voting or the 10-day EmergencyProposer timelock.
- [ ] (Separate migration, outside this directory) Transfer all
      `deployer-EOA` roles in `ownership-snapshot.json` to a multisig.

## What's NOT touched

These were considered and explicitly left alone:

- `EmergencyProposer.owner = GovernorV2` — the timelock contract's executor
  config doesn't matter once we're not using it.
- `ProposerV2.owner = GovernorV2` — bond setting for DVM proposals; not
  blocking regression.
- `GovernorV2.Roles.Proposer` — the role that lets you submit DVM proposals
  via `propose(...)`. Untouched.
- `GovernorV2.Roles.EmergencyProposer` — transient hold during the swap,
  restored to the EmergencyProposer contract by the end of the script.
- `Finder` / `Registry` / `IdentifierWhitelist` / `AddressWhitelist` /
  `Store` / `VotingToken` / `OOv3` — all already EOA, no swap needed.
