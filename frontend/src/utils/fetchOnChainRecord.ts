/**
 * fetchOnChainRecord.ts
 *
 * Browser-side replacement for backend/server.ts's fetchVersionData helper.
 * Reads records directly from the chain and IPFS using the hospital's own
 * connected wallet — msg.sender is the hospital's wallet by construction,
 * so onlyAuthorized and patientConsent checks work correctly with no extra
 * parameters needed.
 */

import { ethers } from "ethers";
import MedicalRecordABI from "../../../shared/MedicalRecordABI.json";
import { hashPatientId } from "./hashPatientId";
import { decryptRecordBrowser, type EncryptedPayload } from "./decryptRecord";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordVersion {
  ipfsHash: string;
  previousIpfsHash: string;
  hospital: string;
  timestamp: number;
  version: number;
}

export interface DecryptedRecord {
  meta: RecordVersion;
  plaintext: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getContract() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer   = await provider.getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, MedicalRecordABI, signer);
}

async function fetchFromIpfs(ipfsHash: string): Promise<EncryptedPayload> {
  const gateway = import.meta.env.VITE_PINATA_GATEWAY as string;
  const url = `https://${gateway}/ipfs/${ipfsHash}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`);
  return res.json();
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface ParsedRecord {
  patientId:          string;
  fullName:           string;
  dateOfBirth:        string;
  patientEmail:       string;
  phone:              string;
  address:            string;
  allergies:          string;
  existingConditions: string;
  bloodGroup:         string;
  symptoms:           string;
  diagnosis:          string;
  medication:         string;
  dosage:             string;
  instructions:       string;
  doctorName:         string;
  department:         string;
  profilePhoto:       string;
  hospital:           string;  // from on-chain named field, not IPFS payload
  timestamp:          string;  // bigint converted to string
  version:            string;
  ipfsHash:           string;
}

// ─── Core fetch + decrypt ─────────────────────────────────────────────────────

/**
 * Fetches a specific version from the chain and IPFS, then decrypts it.
 * Uses getRecordVersion — returns (ipfsHash, previousIpfsHash, hospital, timestamp).
 * version is supplied by the caller, not returned by the contract.
 */
export async function fetchRecordFromChain(
  patientId: string,
  version: number,
  hospitalEmail: string,
  privateKeyPem: string
): Promise<ParsedRecord> {
  const contract = await getContract();

  // Named field access — getRecordVersion returns (ipfsHash, previousIpfsHash, hospital, timestamp)
  const result = await contract.getRecordVersion(hashPatientId(patientId), version);
  const ipfsHash: string = result.ipfsHash;

  // Fetch encrypted payload from IPFS
  const payload = await fetchFromIpfs(ipfsHash);

  // Decrypt in the browser — private key never leaves the client
  const plaintext = await decryptRecordBrowser(payload, privateKeyPem, hospitalEmail);
  const parsed    = JSON.parse(plaintext);

  return {
    patientId,
    fullName:           parsed.fullName           || "",
    dateOfBirth:        parsed.dateOfBirth        || "",
    patientEmail:       parsed.patientEmail       || "",
    phone:              parsed.phone              || "",
    address:            parsed.address            || "",
    allergies:          parsed.allergies          || "",
    existingConditions: parsed.existingConditions || "",
    bloodGroup:         parsed.bloodGroup         || "",
    symptoms:           parsed.symptoms           || "",
    diagnosis:          parsed.diagnosis          || "",
    medication:         parsed.medication         || "",
    dosage:             parsed.dosage             || "",
    instructions:       parsed.instructions       || "",
    doctorName:         parsed.doctorName         || "",
    department:         parsed.department         || "",
    profilePhoto:       parsed.profilePhoto       || "",
    hospital:           result.hospital,               // named on-chain field
    timestamp:          result.timestamp.toString(),   // bigint → string
    version:            version.toString(),            // caller-supplied
    ipfsHash,
  };
}

/**
 * Fetches the latest record version directly via getRecord.
 * Uses getRecord — returns (patientId, ipfsHash, previousIpfsHash, hospital, timestamp, version).
 * version comes from the named field result.version, not a caller-supplied number.
 */
export async function fetchLatestRecordFromChain(
  patientId: string,
  hospitalEmail: string,
  privateKeyPem: string
): Promise<ParsedRecord> {
  const contract = await getContract();

  // Named field access — getRecord returns all six fields including version
  const result = await contract.getRecord(hashPatientId(patientId));
  const ipfsHash: string = result.ipfsHash;

  const payload   = await fetchFromIpfs(ipfsHash);
  const plaintext = await decryptRecordBrowser(payload, privateKeyPem, hospitalEmail);
  const parsed    = JSON.parse(plaintext);

  return {
    patientId,
    fullName:           parsed.fullName           || "",
    dateOfBirth:        parsed.dateOfBirth        || "",
    patientEmail:       parsed.patientEmail       || "",
    phone:              parsed.phone              || "",
    address:            parsed.address            || "",
    allergies:          parsed.allergies          || "",
    existingConditions: parsed.existingConditions || "",
    bloodGroup:         parsed.bloodGroup         || "",
    symptoms:           parsed.symptoms           || "",
    diagnosis:          parsed.diagnosis          || "",
    medication:         parsed.medication         || "",
    dosage:             parsed.dosage             || "",
    instructions:       parsed.instructions       || "",
    doctorName:         parsed.doctorName         || "",
    department:         parsed.department         || "",
    profilePhoto:       parsed.profilePhoto       || "",
    hospital:           result.hospital,               // named on-chain field
    timestamp:          result.timestamp.toString(),   // bigint → string
    version:            result.version.toString(),     // named field — not caller-supplied
    ipfsHash,
  };
}

/**
 * Returns the total number of record versions for a patient.
 * Used by the history view to know how many versions to loop over.
 */
export async function getRecordVersionCount(patientId: string): Promise<number> {
  const contract = await getContract();
  const count = await contract.getRecordCount(hashPatientId(patientId));
  return Number(count);
}
