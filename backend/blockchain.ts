import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const { RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  throw new Error(
    "RPC_URL, PRIVATE_KEY, and CONTRACT_ADDRESS must be set in .env"
  );
}

// ── ABI ───────────────────────────────────────────────────────────────────────
// Resolve from process.cwd() (always backend/) so the path is correct
// whether running via ts-node or compiled JS from dist/.

const ABI_PATH = path.join(
  process.cwd(),
  "..",
  "artifacts",
  "contracts",
  "MedicalRecord.sol",
  "MedicalRecord.json"
);

if (!fs.existsSync(ABI_PATH)) {
  throw new Error(
    `Contract ABI not found at ${ABI_PATH}. ` +
    "Run: npx hardhat compile"
  );
}

const contractABI: any[] = JSON.parse(
  fs.readFileSync(ABI_PATH, "utf8")
).abi;

// ── Provider + Wallet ─────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

// ── Contract instance ─────────────────────────────────────────────────────────

const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

export default contract;
