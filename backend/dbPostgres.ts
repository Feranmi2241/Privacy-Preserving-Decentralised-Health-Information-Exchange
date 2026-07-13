/**
 * dbPostgres.ts — PostgreSQL Database Layer
 *
 * Replaces file-based storage with proper database persistence.
 * Maintains all existing interfaces so no other code changes needed.
 * All professor research implementations remain completely intact.
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Pool, PoolConfig } from "pg";

// ── Types (unchanged from original db.ts) ─────────────────────────────────────
export interface Hospital {
  name: string;
  email: string;
  passwordHash: string;
  passwordHistory: string[];
  verified: boolean;
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
function buildSslConfig(): PoolConfig["ssl"] {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) {
    return false;
  }
  if (process.env.AIVEN_CA_CERT) {
    return { rejectUnauthorized: true, ca: process.env.AIVEN_CA_CERT };
  }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: buildSslConfig(),
});

pool.on("error", (err) => {
  console.error("[DB] Idle client error:", err.message);
});

// ── Database Schema Initialization ────────────────────────────────────────────
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS patient_emails (
        patient_id VARCHAR(100) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS otps (
        key VARCHAR(255) PRIMARY KEY,
        code VARCHAR(10) NOT NULL,
        expires_at BIGINT NOT NULL,
        purpose VARCHAR(10) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        token VARCHAR(64) PRIMARY KEY,
        patient_id VARCHAR(100) NOT NULL,
        patient_email VARCHAR(255) NOT NULL,
        hospital_name VARCHAR(255) NOT NULL,
        hospital_email VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL
      )
    `);

    console.log("[DB] Tables ready");
  } catch (error) {
    console.error("[DB] Initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000;
const ACCESS_REQUEST_TTL = 20 * 60 * 1000;

// ── Password helpers ──────────────────────────────────────────────────────────
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

// ── Hospital CRUD ─────────────────────────────────────────────────────────────
export async function findHospital(email: string): Promise<Hospital | undefined> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT name, email, password_hash, password_history, verified FROM hospitals WHERE email = $1",
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
      "INSERT INTO hospitals (name, email, password_hash, password_history, verified) VALUES ($1, $2, $3, $4, $5)",
      [name, email.toLowerCase(), passwordHash, [], false]
    );
    return { name, email: email.toLowerCase(), passwordHash, passwordHistory: [], verified: false };
  } finally {
    client.release();
  }
}

export async function markVerified(email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("UPDATE hospitals SET verified = TRUE WHERE email = $1", [email.toLowerCase()]);
  } finally {
    client.release();
  }
}

export async function updatePassword(email: string, newPlain: string): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT password_hash, password_history FROM hospitals WHERE email = $1",
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return;
    const currentHash = result.rows[0].password_hash;
    const currentHistory = result.rows[0].password_history || [];
    const newHistory = [...currentHistory, currentHash].slice(-5);
    const newHash = await hashPassword(newPlain);
    await client.query(
      "UPDATE hospitals SET password_hash = $1, password_history = $2 WHERE email = $3",
      [newHash, newHistory, email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

// ── Patient email store ───────────────────────────────────────────────────────
export async function storePatientEmail(patientId: string, email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO patient_emails (patient_id, email) VALUES ($1, $2) ON CONFLICT (patient_id) DO UPDATE SET email = $2",
      [patientId.toLowerCase(), email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

export async function getPatientEmail(patientId: string): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT email FROM patient_emails WHERE patient_id = $1",
      [patientId.toLowerCase()]
    );
    return result.rows.length > 0 ? result.rows[0].email : undefined;
  } finally {
    client.release();
  }
}

// ── OTP helpers ───────────────────────────────────────────────────────────────
export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function storeOTP(email: string, code: string, purpose: "signup" | "forgot"): Promise<void> {
  const key = `${purpose}:${email.toLowerCase()}`;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO otps (key, code, expires_at, purpose) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET code = $2, expires_at = $3`,
      [key, code, Date.now() + OTP_TTL_MS, purpose]
    );
  } finally { client.release(); }
}

export async function verifyOTP(email: string, code: string, purpose: "signup" | "forgot"): Promise<boolean> {
  const key = `${purpose}:${email.toLowerCase()}`;
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT code, expires_at FROM otps WHERE key = $1", [key]);
    if (result.rows.length === 0) return false;
    const { code: stored, expires_at } = result.rows[0];
    if (Date.now() > Number(expires_at)) {
      await client.query("DELETE FROM otps WHERE key = $1", [key]);
      return false;
    }
    if (!crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(code))) return false;
    await client.query("DELETE FROM otps WHERE key = $1", [key]);
    return true;
  } finally { client.release(); }
}

// ── Access request helpers (PostgreSQL-backed) ────────────────────────────────
export async function createAccessRequest(
  patientId: string,
  patientEmail: string,
  hospitalName: string,
  hospitalEmail: string
): Promise<AccessRequest> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE access_requests SET status = 'expired'
       WHERE patient_id = $1 AND hospital_email = $2 AND status = 'pending'`,
      [patientId, hospitalEmail.toLowerCase()]
    );
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + ACCESS_REQUEST_TTL;
    await client.query(
      `INSERT INTO access_requests
         (token, patient_id, patient_email, hospital_name, hospital_email, expires_at, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [token, patientId, patientEmail.toLowerCase(), hospitalName, hospitalEmail.toLowerCase(), expiresAt, now]
    );
    return {
      token, patientId,
      patientEmail: patientEmail.toLowerCase(),
      hospitalName,
      hospitalEmail: hospitalEmail.toLowerCase(),
      expiresAt, status: "pending", createdAt: now,
    };
  } finally { client.release(); }
}

export async function consumeAccessToken(token: string, action: "approved" | "denied"): Promise<AccessRequest | null> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM access_requests WHERE token = $1", [token]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.status !== "pending") return null;
    if (Date.now() > Number(row.expires_at)) {
      await client.query("UPDATE access_requests SET status = 'expired' WHERE token = $1", [token]);
      return null;
    }
    await client.query("UPDATE access_requests SET status = $1 WHERE token = $2", [action, token]);
    return {
      token: row.token,
      patientId: row.patient_id,
      patientEmail: row.patient_email,
      hospitalName: row.hospital_name,
      hospitalEmail: row.hospital_email,
      expiresAt: Number(row.expires_at),
      status: action,
      createdAt: Number(row.created_at),
    };
  } finally { client.release(); }
}

export async function checkAccessStatus(patientId: string, hospitalEmail: string): Promise<"pending" | "approved" | "denied" | "expired" | "not_found"> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT status, expires_at FROM access_requests
       WHERE patient_id = $1 AND hospital_email = $2
       ORDER BY created_at DESC LIMIT 1`,
      [patientId, hospitalEmail.toLowerCase()]
    );
    if (result.rows.length === 0) return "not_found";
    const { status, expires_at } = result.rows[0];
    if (status === "pending" && Date.now() > Number(expires_at)) {
      await client.query(
        `UPDATE access_requests SET status = 'expired'
         WHERE patient_id = $1 AND hospital_email = $2 AND status = 'pending'`,
        [patientId, hospitalEmail.toLowerCase()]
      );
      return "expired";
    }
    return status;
  } finally { client.release(); }
}

export async function getAccessRequestTimeRemaining(patientId: string, hospitalEmail: string): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT expires_at FROM access_requests
       WHERE patient_id = $1 AND hospital_email = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [patientId, hospitalEmail.toLowerCase()]
    );
    if (result.rows.length === 0) return 0;
    return Math.max(0, Number(result.rows[0].expires_at) - Date.now());
  } finally { client.release(); }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
