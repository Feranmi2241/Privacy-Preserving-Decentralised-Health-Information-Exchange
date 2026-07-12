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
// Pool lives at module scope — Node's module cache keeps it alive across warm
// invocations of the same serverless instance, reusing the connection instead
// of opening a new one on every request.
//
// max:1  — each Vercel instance holds at most 1 physical Postgres connection.
//          Aiven free tier = 25 connections max. With pg's default max:10 you
//          exhaust the limit at just 3 parallel cold-start instances.
//
// idleTimeoutMillis:10000 — releases idle connections after 10 s so cooled-
//          down instances don't leave stale connections open on Aiven.
//
// connectionTimeoutMillis:5000 — fail fast on cold start if Aiven is
//          unreachable, rather than hanging until Vercel's function timeout
//          kills the request with no useful log message.

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

// Surface pool-level errors in Vercel function logs. Without this, a dropped
// idle connection causes the next query to fail with a cryptic error and no
// stack trace pointing to the real cause.
pool.on("error", (err) => {
  console.error("[DB] Idle client error:", err.message);
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

    // OTPs table — persisted in DB so Render spin-down doesn't wipe them
    await client.query(`
      CREATE TABLE IF NOT EXISTS otps (
        key VARCHAR(255) PRIMARY KEY,
        code VARCHAR(10) NOT NULL,
        expires_at BIGINT NOT NULL,
        purpose VARCHAR(10) NOT NULL
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

// ── In-memory state ─────────────────────────────────────────────────────────
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
    const result = await client.query('SELECT code, expires_at FROM otps WHERE key = $1', [key]);
    if (result.rows.length === 0) return false;
    const { code: stored, expires_at } = result.rows[0];
    if (Date.now() > Number(expires_at)) {
      await client.query('DELETE FROM otps WHERE key = $1', [key]);
      return false;
    }
    if (!crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(code))) {
      return false;
    }
    await client.query('DELETE FROM otps WHERE key = $1', [key]);
    return true;
  } finally { client.release(); }
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