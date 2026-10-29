# Cloud agent notes

Yarn 1 workspaces and Lerna. Solidity contracts live in `packages/core`; bots and libraries are the other `packages/*` workspaces. Local build and unit tests do not need a running service.

## Install

```bash
bash .cursor/install.sh
```

Installs `libudev-dev`, `libusb-1.0-0-dev`, and `rsync`, puts Foundry 0.3.0 on `/usr/local/bin`, and runs `yarn --frozen-lockfile`. The default image already provides Node 22 and Yarn 1.22. The script is safe to run again.

## Build, lint, test

```bash
yarn qbuild
yarn lint
yarn test
```

`yarn qbuild` is the same as `yarn build`. Run it before `yarn test`.

Verified package commands:

```bash
yarn workspace @uma/core forge-test
yarn workspace @uma/core exec hardhat test test/hardhat/optimistic-oracle-v2/OptimisticOracleV2.js --network hardhat
yarn workspace @uma/common test
yarn workspace @uma/logger test
yarn workspace @uma/api test
yarn workspace @uma/scripts test
yarn workspace @uma/financial-templates-lib test
yarn workspace @uma/monitors test
yarn workspace @uma/toolkit test
yarn workspace @uma/sdk test
```

## Gotchas

- The README asks for Node 20. CircleCI (`.circleci/config.yml`) and this environment use Node 22. Hardhat warns that Node is unsupported; `yarn qbuild` still completes.
- CircleCI pins Foundry `nightly-70cd140131cd49875c6f31626bdfae08eba35386`. Current `foundryup` refuses that tag because it has no Sigstore attestation. Foundry 1.8.6 fails these contracts with "stack too deep". Attested Foundry 0.3.0 passes `packages/core` forge tests.
- `yarn qbuild` runs `packages/core/scripts/SetUpFoundryWithHardhat.sh`, which creates gitignored `packages/core/lib`. `yarn lint` after that exits 2: Prettier cannot parse the generated forge-std sources. CI lints before that directory exists. Move `packages/core/lib` aside before linting, or lint before the core build step.
- `yarn lint` also lists `README.md` under Prettier. That mismatch is already in the tree.
- `yarn workspace @uma/serverless-orchestration test` sets `HARDHAT_NETWORK=localhost` and expects a node at `http://127.0.0.1:9545`. Without that node, hub tests fail connecting for `eth_chainId`. Other local Hardhat and Foundry tests do not need it.
- `yarn test-fork`, deploys, and live bots need RPC and wallet secrets. Local Hardhat and Foundry tests do not. If `MNEMONIC` is unset, Hardhat uses the public fallback phrase in `packages/common/src/ProviderUtils.ts`.

Secret and endpoint names for live runs (values stay out of the repo):

- `MNEMONIC`, `PRIVATE_KEY`, `GCKMS_WALLET`, `GCKMS_KEYS`, `GCKMS_CONFIG`
- `CUSTOM_NODE_URL`, `NODE_URL_<chainId>`, `CROSS_CHAIN_NODE_URL`, `INFURA_API_KEY`
- `ETHERSCAN_API_KEY`
- `TENDERLY_USER`, `TENDERLY_PROJECT`, `TENDERLY_ACCESS_KEY`
- `POLYMARKET_API_KEY`
- `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` (`packages/discord-ticket-api/.env.example`)
