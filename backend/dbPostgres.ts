/**
 * dbPostgres.ts — PostgreSQL Database Layer
 * 
 * Replaces file-based storage with proper database persistence.
 * Maintains all existing interfaces so no other code changes needed.
 * All professor research implementations remain completely intact.
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Pool } from "pg";

// ── Types (unchanged from original db.ts) ─────────────────────────────────────
export interface Hospital {
  name: string;
  email: string;
  passwordHash: string;
  passwordHistory: string[];
  verified: boolean;
}

interface OTPRecord {
  code: string;
  expiresAt: number;
  purpose: "signup" | "forgot";
}

export interface AccessRequest {
  token: string;
  patientId: string;
  patientEmail: string;
  hospitalName: string;
  hospitalEmail: string;
  expiresAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
}

// ── Database Connection ───────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Database Schema Initialization ────────────────────────────────────────────
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // Hospitals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hospitals (
        email VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        password_history TEXT[] DEFAULT '{}',
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Patient emails table
    await client.query(`
      CREATE TABLE IF NOT EXISTS patient_emails (
        patient_id VARCHAR(100) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("[Database] PostgreSQL tables initialized successfully");
  } catch (error) {
    console.error("[Database] Initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

// ── In-memory state (unchanged) ───────────────────────────────────────────────
// OTPs and access requests remain in-memory as they should be ephemeral
const otpStore = new Map<string, OTPRecord>();
const accessRequests = new Map<string, AccessRequest>();
const resolvedStatus = new Map<string, "approved" | "denied" | "expired">();

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000;
const ACCESS_REQUEST_TTL = 20 * 60 * 1000;

// ── Password helpers (unchanged) ──────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function isPasswordReused(plain: string, history: string[]): Promise<boolean> {
  for (const h of history) {
    if (await bcrypt.compare(plain, h)) return true;
  }
  return false;
}

// ── Hospital CRUD (now using PostgreSQL) ─────────────────────────────────────
export async function findHospital(email: string): Promise<Hospital | undefined> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT name, email, password_hash, password_history, verified FROM hospitals WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return undefined;
    
    const row = result.rows[0];
    return {
      name: row.name,
      email: row.email,
      passwordHash: row.password_hash,
      passwordHistory: row.password_history || [],
      verified: row.verified,
    };
  } finally {
    client.release();
  }
}

export async function createHospital(name: string, email: string, plain: string): Promise<Hospital> {
  const passwordHash = await hashPassword(plain);
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO hospitals (name, email, password_hash, password_history, verified) VALUES ($1, $2, $3, $4, $5)',
      [name, email.toLowerCase(), passwordHash, [], false]
    );
    return {
      name,
      email: email.toLowerCase(),
      passwordHash,
      passwordHistory: [],
      verified: false,
    };
  } finally {
    client.release();
  }
}

export async function markVerified(email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('UPDATE hospitals SET verified = TRUE WHERE email = $1', [email.toLowerCase()]);
  } finally {
    client.release();
  }
}

export async function updatePassword(email: string, newPlain: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Get current password hash to add to history
    const result = await client.query('SELECT password_hash, password_history FROM hospitals WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return;
    
    const currentHash = result.rows[0].password_hash;
    const currentHistory = result.rows[0].password_history || [];
    const newHistory = [...currentHistory, currentHash].slice(-5); // Keep last 5
    const newHash = await hashPassword(newPlain);
    
    await client.query(
      'UPDATE hospitals SET password_hash = $1, password_history = $2 WHERE email = $3',
      [newHash, newHistory, email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

// ── Patient email store (now using PostgreSQL) ───────────────────────────────
export async function storePatientEmail(patientId: string, email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO patient_emails (patient_id, email) VALUES ($1, $2) ON CONFLICT (patient_id) DO UPDATE SET email = $2',
      [patientId.toLowerCase(), email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

export async function getPatientEmail(patientId: string): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT email FROM patient_emails WHERE patient_id = $1', [patientId.toLowerCase()]);
    return result.rows.length > 0 ? result.rows[0].email : undefined;
  } finally {
    client.release();
  }
}

// ── OTP helpers (unchanged - remain in-memory) ───────────────────────────────
export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function storeOTP(email: string, code: string, purpose: "signup" | "forgot"): void {
  otpStore.set(`${purpose}:${email.toLowerCase()}`, {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    purpose,
  });
}

export function verifyOTP(email: string, code: string, purpose: "signup" | "forgot"): boolean {
  const key = `${purpose}:${email.toLowerCase()}`;
  const record = otpStore.get(key);
  if (!record) return false;
  if (Date.now() > record.expiresAt) { otpStore.delete(key); return false; }
  if (record.code !== code) return false;
  otpStore.delete(key);
  return true;
}

// ── Access request helpers (unchanged - remain in-memory) ─────────────────────
export function createAccessRequest(
  patientId: string,
  patientEmail: string,
  hospitalName: string,
  hospitalEmail: string
): AccessRequest {
  const resolvedKey = `${patientId}:${hospitalEmail.toLowerCase()}`;
  resolvedStatus.delete(resolvedKey);
  for (const [key, req] of accessRequests.entries()) {
    if (
      req.patientId === patientId &&
      req.hospitalEmail === hospitalEmail.toLowerCase() &&
      req.status === "pending"
    ) {
      accessRequests.delete(key);
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  const request: AccessRequest = {
    token,
    patientId,
    patientEmail: patientEmail.toLowerCase(),
    hospitalName,
    hospitalEmail: hospitalEmail.toLowerCase(),
    expiresAt: Date.now() + ACCESS_REQUEST_TTL,
    status: "pending",
    createdAt: Date.now(),
  };
  accessRequests.set(token, request);
  return request;
}

export function getAccessRequest(token: string): AccessRequest | undefined {
  return accessRequests.get(token);
}

export function consumeAccessToken(token: string, action: "approved" | "denied"): AccessRequest | null {
  const req = accessRequests.get(token);
  if (!req) return null;
  if (req.status !== "pending") return null;
  if (Date.now() > req.expiresAt) {
    req.status = "expired";
    return null;
  }
  req.status = action;
  const resolvedKey = `${req.patientId}:${req.hospitalEmail}`;
  resolvedStatus.set(resolvedKey, action);
  accessRequests.delete(token);
  return req;
}

export function checkAccessStatus(patientId: string, hospitalEmail: string): "pending" | "approved" | "denied" | "expired" | "not_found" {
  const resolvedKey = `${patientId}:${hospitalEmail.toLowerCase()}`;
  const resolved = resolvedStatus.get(resolvedKey);
  if (resolved) return resolved;

  for (const req of accessRequests.values()) {
    if (req.patientId === patientId && req.hospitalEmail === hospitalEmail.toLowerCase()) {
      if (Date.now() > req.expiresAt) {
        req.status = "expired";
        resolvedStatus.set(resolvedKey, "expired");
        return "expired";
      }
      return req.status;
    }
  }
  return "not_found";
}

export function getAccessRequestTimeRemaining(patientId: string, hospitalEmail: string): number {
  for (const req of accessRequests.values()) {
    if (
      req.patientId === patientId &&
      req.hospitalEmail === hospitalEmail.toLowerCase() &&
      req.status === "pending"
    ) {
      return Math.max(0, req.expiresAt - Date.now());
    }
  }
  return 0;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
export async function closeDatabase(): Promise<void> {
  await pool.end();
}