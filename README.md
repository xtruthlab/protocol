# xtruth protocol

The core smart contracts powering **[xtruth](https://xtruth.xyz)** — the
optimistic oracle and Data Verification Mechanism (DVM) for
**X Layer** (OKX's L2). This monorepo contains the on-chain truth machine:
stake-weighted commit–reveal voting, the optimistic oracle family
(OOv1 / OOv2 / OOv3 / Skinny), governance, and the off-chain bots and
tooling that operate them.

## Networks 🌐

| | X Layer Mainnet | X Layer Testnet |
| --- | --- | --- |
| chainId | `196` | `1952` |
| App | [app.xtruth.xyz](https://app.xtruth.xyz) | [app-dev.xtruth.xyz](https://app-dev.xtruth.xyz) |
| Explorer | [oklink.com/xlayer](https://www.oklink.com/xlayer) | [oklink.com/xlayer-test](https://www.oklink.com/xlayer-test) |

Deployed contract addresses for both networks are listed at
[xtruth.xyz/docs/contracts](https://xtruth.xyz/docs/contracts/).

## Documentation 📚

Integration guides, lifecycle diagrams, subgraph endpoints and ABIs live at
[xtruth.xyz/docs](https://xtruth.xyz/docs/).

## What's in here 🗂

The repo is a yarn-workspaces + lerna monorepo; each package lives under
`packages/` with its own scripts and dependencies. The ones that matter most:

- **`packages/core`** — all Solidity contracts:
  - `data-verification-mechanism/` — DVM 2.0: `VotingV2` (stake + commit–reveal
    voting), `Staker`, slashing libraries, `Finder`, `Store`, whitelists,
    governance (`GovernorV2`, `ProposerV2`, `EmergencyProposer`).
  - `optimistic-oracle-v3/` — assertion-based oracle (`assertTruth`).
  - `optimistic-oracle/`, `optimistic-oracle-v2/`, skinny variants —
    price-request oracles.
- **`packages/monitor-v2`**, **`packages/financial-templates-lib`** — off-chain
  bots (proposer / disputer / monitor).
- **`packages/common`**, **`packages/sdk`**, **`packages/contracts-node`** —
  shared JS/TS tooling.

> ⚠️ **Contract code is treated as read-mostly.** The audited core contract
> logic is intentionally kept unmodified; deployments are parameterized
> through constructor args and deployment scripts, not by editing contract
> logic. Package scopes remain `@uma/*` for the same reason — renaming them
> would churn every import for zero functional gain.

## Developer quickstart 👩‍💻

You'll need nodejs v20 (LTS) and yarn.

```sh
yarn               # install all workspace deps
yarn qbuild        # quick build (skips dapps)
yarn build         # full build
yarn clean         # remove build artifacts
```

### Lint 🧽

```sh
yarn lint          # check
yarn lint-fix      # autofix
```

### Working with packages 📦

Standard yarn-workspaces / lerna usage:

```sh
yarn workspace <package_name> <script>     # run a script in one package
yarn lerna run <script> --stream           # run it in every package
yarn workspace <package_name> add <dep>    # add a dependency to a package
```

### Coverage 🔎

```sh
./ci/coverage.sh packages/core
# then open packages/core/coverage/index.html
```

### Style

See [STYLE.md](STYLE.md).

## License ⚖️

AGPL-3.0 — see [LICENSE](./LICENSE). Public deployments of derived versions
must publish their source.
