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
const { ethers } = hre;

// Env-overridable so the same script works on mainnet. Falls back to the
// canonical X Layer testnet addresses. REGISTRY can also come from the
// hardhat deployment (REGISTRY_ADDRESS env), MOOv2 from MOOV2_ADDRESS.
const REGISTRY = process.env.REGISTRY_ADDRESS || "0x10c01D10a7b81De1f36096cdB4085d7195f046CB";
const MOOV2 = process.env.MOOV2_ADDRESS || "0x88f80d0cd78b8d014032c8862dce1b91662330d8";
const CONTRACT_CREATOR_ROLE = 1; // Registry.Roles { Owner=0, ContractCreator=1 }

const abi = [
  "function isContractRegistered(address) view returns (bool)",
  "function holdsRole(uint256,address) view returns (bool)",
  "function addMember(uint256,address)",
  "function registerContract(address[],address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const reg = new ethers.Contract(REGISTRY, abi, signer);
  console.log("signer:", signer.address);
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
