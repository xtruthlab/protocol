// Register the ManagedOptimisticOracleV2 (MOOv2) in the DVM Registry so its
// disputes can escalate to VotingV2. WITHOUT this, MOOv2.disputePrice reverts
// "Caller not registered" when it calls Oracle(VotingV2).requestPrice — OOv2/
// OOv3 were registered during the canonical setup, but MOOv2 was deployed later
// and missed. Idempotent.
//
// Run:
//   set -a; source ./.env; set +a; export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
//   export NODE_URL_1952="https://app.xtruth.xyz/api/rpc"
//   yarn hardhat run scripts/register-moov2-dvm.js --network xlayer-testnet
const hre = require("hardhat");
const { ethers, deployments } = hre;

const CONTRACT_CREATOR_ROLE = 1; // Registry.Roles { Owner=0, ContractCreator=1 }

const abi = [
  "function isContractRegistered(address) view returns (bool)",
  "function holdsRole(uint256,address) view returns (bool)",
  "function addMember(uint256,address)",
  "function registerContract(address[],address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();

  // Registry: prefer hardhat-deploy artifact (auto-correct per network);
  // env override REGISTRY_ADDRESS wins if set. No hardcoded fallback —
  // accidentally targeting the wrong chain's Registry was the source of
  // the "call revert exception" bug.
  let REGISTRY = process.env.REGISTRY_ADDRESS;
  if (!REGISTRY) {
    try {
      REGISTRY = (await deployments.get("Registry")).address;
    } catch {
      throw new Error(`No Registry deployment artifact for chainId ${chainId} and REGISTRY_ADDRESS env not set`);
    }
  }

  // MOOv2 is forge-deployed (not in hardhat artifacts) so require env.
  const MOOV2 = process.env.MOOV2_ADDRESS;
  if (!MOOV2) throw new Error("MOOV2_ADDRESS env not set");

  const reg = new ethers.Contract(REGISTRY, abi, signer);
  console.log("signer:  ", signer.address);
  console.log("chainId: ", chainId);
  console.log("Registry:", REGISTRY);
  console.log("MOOv2:   ", MOOV2);
  console.log("MOOv2 registered?", await reg.isContractRegistered(MOOV2));

  if (!(await reg.holdsRole(CONTRACT_CREATOR_ROLE, signer.address))) {
    const tx = await reg.addMember(CONTRACT_CREATOR_ROLE, signer.address);
    console.log("addMember(ContractCreator):", tx.hash);
    await tx.wait();
  }
  if (!(await reg.isContractRegistered(MOOV2))) {
    const tx = await reg.registerContract([], MOOV2);
    console.log("registerContract(MOOv2):", tx.hash);
    await tx.wait();
  }
  console.log("MOOv2 registered now?", await reg.isContractRegistered(MOOV2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
