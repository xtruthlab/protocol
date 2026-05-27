const { getHardhatConfig } = require("@uma/common");

// OKLink (X Layer) contract verification uses OKX's own Hardhat plugin
// — NOT @nomicfoundation/hardhat-verify. The plugin registers an
// `okverify` task and reads from an `okxweb3explorer` config block.
// Required for the OKX Wallet signing prompt to decode our calls as
// `assertTruth(...)` / `requestPrice(...)` etc instead of "未知交易类型".
// API key minted at https://web3.okx.com/build/dev-portal (wallet auth,
// single access key — NOT exchange-style AK/SK/passphrase).
require("@okxweb3/hardhat-explorer-verify");

const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("@uma/core/package.json"));

let typechain = undefined;
if (process.env.TYPECHAIN === "web3") {
  typechain = { outDir: "contract-types/web3", target: "web3-v1", alwaysGenerateOverloads: false };
} else if (process.env.TYPECHAIN === "ethers") {
  typechain = { outDir: "contract-types/ethers", target: "ethers-v5", alwaysGenerateOverloads: false };
}

if (typechain !== undefined) require("@typechain/hardhat");

const configOverride = {
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`,
  },
  typechain,
  // Single API-key config for the OKX plugin. Loaded from env so the
  // value isn't committed. The plugin doesn't need a per-network key map;
  // one key works for every chain in OKLink's network list.
  okxweb3explorer: {
    apiKey: process.env.OKX_WEB3_API_KEY ?? "",
  },
};

module.exports = getHardhatConfig(configOverride, __dirname);
