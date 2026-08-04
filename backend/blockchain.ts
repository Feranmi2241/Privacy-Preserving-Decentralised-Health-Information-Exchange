import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const { RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  throw new Error(
    "RPC_URL, PRIVATE_KEY, and CONTRACT_ADDRESS must be set in .env"
  );
}

// ── ABI ───────────────────────────────────────────────────────────────────────
// __dirname is backend/ under ts-node and backend/dist/ when compiled.
// One ".." from backend/ and two ".." from backend/dist/ both reach the
// project root — so we try one level up first, then two, to handle both.

function findAbiPath(): string {
  const rel = path.join("artifacts", "contracts", "MedicalRecord.sol", "MedicalRecord.json");
  const oneLevelUp  = path.join(__dirname, "..",      rel);
  const twoLevelsUp = path.join(__dirname, "..", "..", rel);
  if (fs.existsSync(oneLevelUp))  return oneLevelUp;
  if (fs.existsSync(twoLevelsUp)) return twoLevelsUp;
  throw new Error(
    `Contract ABI not found at either:\n  ${oneLevelUp}\n  ${twoLevelsUp}\n` +
    "Run: npx hardhat compile"
  );
}

const ABI_PATH = findAbiPath();

const contractABI: any[] = JSON.parse(
  fs.readFileSync(ABI_PATH, "utf8")
).abi;

// ── Provider + Wallet ─────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

// ── Contract instance ─────────────────────────────────────────────────────────

const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

export { provider };
export default contract;
