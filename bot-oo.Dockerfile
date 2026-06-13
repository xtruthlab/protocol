# Settlement bot (monitor-v2 bot-oo) for X Layer — settles expired OOv1/OOv2/
# SkinnyOO requests (OOv3 is covered separately by xtruth-bots).
#
# Build context = protocol monorepo ROOT:
#   docker build -f bot-oo.Dockerfile -t xtruth-bot-oo .
#
# Strategy: ship the PREBUILT package dist/ (the repo must be built locally
# first — `yarn build` at the root; core's full build needs Foundry+hardhat,
# which we deliberately do NOT redo in-image). A fresh in-image `yarn install`
# provides Linux-native node_modules; the dist/ is platform-independent JS.
# Node 20 to match the monorepo (hardhat 2.x / @truffle/contract toolchain).
FROM node:20

WORKDIR /app

# Source + prebuilt dist/ come in via the build context; the big root
# node_modules is excluded by .dockerignore and rebuilt fresh below for Linux.
COPY . .

# Linux node_modules. --ignore-scripts skips native add-on builds
# (bufferutil / utf-8-validate / secp256k1 / keccak): the repo's old node-gyp
# 7.1.2 can't build them on Node 20, and they're all optional accelerators
# with pure-JS fallbacks (the bot already runs on them — "secp256k1
# unavailable, reverting to browser version"). The repo has no root
# postinstall / patch-package, so nothing else needs install scripts, and the
# @uma packages run from the prebuilt dist/ copied in above.
RUN yarn install --frozen-lockfile --non-interactive --ignore-scripts \
  && yarn cache clean

WORKDIR /app/packages/monitor-v2

# All behaviour is env-driven (CHAIN_ID, NODE_URL_<id>, ORACLE_TYPE,
# ORACLE_ADDRESS, SETTLEMENTS_ENABLED, POLLING_DELAY, MNEMONIC, …).
CMD ["node", "dist/bot-oo/index.js"]
