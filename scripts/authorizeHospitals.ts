/**
 * authorizeHospitals.ts — one-off post-deploy script
 *
 * Reads every non-revoked hospital with a wallet_address from Postgres
 * and calls authorizeHospital(walletAddress) on the new contract using
 * the owner wallet (the same wallet that deployed the contract).
 *
 * Run from the project root after a fresh deploy:
 *   set SEPOLIA_RPC_URL=... && set SEPOLIA_PRIVATE_KEY=... && npx ts-node -e "..." 
 *   OR from backend/ where dotenv loads automatically:
 *   cd backend && npx ts-node ../scripts/authorizeHospitals.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load backend/.env so RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, DATABASE_URL are all available
dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

import { ethers } from "ethers";
import * as fs from "fs";
import { Pool } from "pg";

const { RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, DATABASE_URL } = process.env;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS || !DATABASE_URL) {
  throw new Error("RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, and DATABASE_URL must be set");
}

function findAbiPath(): string {
  const rel = path.join("artifacts", "contracts", "MedicalRecord.sol", "MedicalRecord.json");
  const oneLevelUp  = path.join(__dirname, "..",      rel);
  const twoLevelsUp = path.join(__dirname, "..", "..", rel);
  if (fs.existsSync(oneLevelUp))  return oneLevelUp;
  if (fs.existsSync(twoLevelsUp)) return twoLevelsUp;
  throw new Error(`ABI not found. Run: npx hardhat compile`);
}

const contractABI: any[] = JSON.parse(fs.readFileSync(findAbiPath(), "utf8")).abi;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  let rows: { email: string; name: string; wallet_address: string }[];
  try {
    const result = await client.query(
      "SELECT email, name, wallet_address FROM hospitals WHERE wallet_address IS NOT NULL AND revoked = FALSE"
    );
    rows = result.rows;
  } finally {
    client.release();
  }

  console.log(`Found ${rows.length} hospital(s) with a wallet address on file.`);

  if (rows.length === 0) {
    console.log("Nothing to authorize.");
    return;
  }

  for (const row of rows) {
    const { email, name, wallet_address } = row;
    console.log(`\nAuthorizing: ${name} <${email}> — wallet ${wallet_address}`);
    try {
      const tx = await contract.authorizeHospital(wallet_address);
      console.log(`  tx sent: ${tx.hash}`);
      await tx.wait();
      console.log(`  confirmed ✓`);
    } catch (err: any) {
      console.error(`  FAILED: ${err.message}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => pool.end());
