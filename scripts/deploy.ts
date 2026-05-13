import { network } from "hardhat";

async function main() {
  console.log("--------------------------------------------------");
  console.log("Deploying MedicalRecord Smart Contract...");
  console.log("--------------------------------------------------");

  const { ethers } = await network.connect();

  const contract = await ethers.deployContract("MedicalRecord");

  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("--------------------------------------------------");
  console.log("MedicalRecord Contract deployed successfully!");
  console.log("Contract Address:", address);
  console.log("--------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});