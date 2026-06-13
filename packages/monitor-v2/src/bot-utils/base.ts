import { getGckmsSigner, getMnemonicSigner, getRetryProvider } from "@uma/common";
import { BlockFinder } from "@uma/sdk";
import type { Block, Provider } from "@ethersproject/abstract-provider";
import { Signer, Wallet } from "ethers";
import { blockDefaults } from "../utils/constants";

export interface BaseMonitoringParams {
  provider: Provider;
  chainId: number;
  signer: Signer;
  timeLookback: number;
  maxBlockLookBack: number;
  blockFinder: BlockFinder<Block>;
  pollingDelay: number;
  gasLimitMultiplier: number;
}

export const initBaseMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<BaseMonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  const provider = getRetryProvider(chainId) as Provider;

  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  // Signer priority: GCKMS → raw PRIVATE_KEY → MNEMONIC. PRIVATE_KEY lets a
  // bot use an existing single key directly (you cannot derive a mnemonic
  // from a private key — it's one-way). Accept the key with or without 0x.
  let signer: Signer;
  if (process.env.GCKMS_WALLET) {
    signer = ((await getGckmsSigner()) as Wallet).connect(provider);
  } else if (process.env.PRIVATE_KEY) {
    const pk = process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`;
    signer = new Wallet(pk).connect(provider);
  } else {
    signer = (getMnemonicSigner() as Signer).connect(provider);
  }

  const timeLookback = Number(env.TIME_LOOKBACK) || 72 * 60 * 60;

  const maxBlockLookBack =
    Number(env.MAX_BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.maxBlockLookBack ||
    blockDefaults.other.maxBlockLookBack;

  const blockFinder = new BlockFinder(provider.getBlock.bind(provider), undefined, chainId);

  const gasLimitMultiplier = Number(env.GAS_LIMIT_MULTIPLIER) || 150; // percent

  return {
    provider,
    chainId,
    signer,
    timeLookback,
    maxBlockLookBack,
    blockFinder,
    pollingDelay,
    gasLimitMultiplier,
  };
};

export const startupLogLevel = (params: { pollingDelay: number }): "debug" | "info" =>
  params.pollingDelay === 0 ? "debug" : "info";
