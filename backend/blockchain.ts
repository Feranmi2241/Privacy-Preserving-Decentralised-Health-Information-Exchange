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
// __dirname always resolves to the directory of THIS file (backend/ when
// running via ts-node, backend/dist/ when compiled). Using process.cwd()+".."
// breaks on Vercel where cwd() is /var/task, not the backend directory.

const ABI_PATH = path.join(
  __dirname,
  "..",
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
