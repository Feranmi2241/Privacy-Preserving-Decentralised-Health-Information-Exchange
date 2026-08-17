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
  revoked: boolean;
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
        created_at TIMESTAMP DEFAULT NOW(),
        rsa_public_key TEXT,
        wallet_address VARCHAR(42),
        revoked BOOLEAN DEFAULT FALSE
      )
    `);
    await client.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS rsa_public_key TEXT;`);
    await client.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);`);
    await client.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT FALSE;`);

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
      CREATE TABLE IF NOT EXISTS pending_submissions (
        submission_id VARCHAR(64) PRIMARY KEY,
        patient_id    VARCHAR(100) NOT NULL,
        created_at    TIMESTAMP DEFAULT NOW(),
        status        VARCHAR(10) NOT NULL DEFAULT 'pending'
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS revoke_tokens (
        token       VARCHAR(64) PRIMARY KEY,
        patient_id  VARCHAR(100) NOT NULL,
        hospital_email TEXT NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        token VARCHAR(64) PRIMARY KEY,
        patient_id VARCHAR(100) NOT NULL,
        patient_email VARCHAR(255) NOT NULL,
        hospital_name VARCHAR(255) NOT NULL,
        hospital_email VARCHAR(255) NOT NULL,
        hospital_email_hash VARCHAR(64),
        expires_at BIGINT NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS hospital_email_hash VARCHAR(64);`);

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

// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function hashForLookup(value: string): string {
  // Deterministic one-way HMAC-SHA256 fingerprint — used for WHERE-clause lookups
  // on encrypted columns. NOT reversible. Separate key from DB_ENCRYPTION_KEY.
  return crypto.createHmac("sha256", process.env.DB_HASH_KEY!).update(value.toLowerCase()).digest("hex");
}

// ── Column-level encryption helpers (AES-256-GCM) ────────────────────────────
// Used to encrypt PII columns (emails) at rest in Postgres.
// Requires DB_ENCRYPTION_KEY env var: 64 hex chars = 32 bytes.
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function getColumnKey(): Buffer {
  const hex = process.env.DB_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("[DB] DB_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptColumn(plaintext: string): string {
  const key = getColumnKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV standard for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag   = cipher.getAuthTag(); // 16-byte tag
  // Format: "iv:authTag:ciphertext" — all hex, colon-delimited, stored as single TEXT column
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptColumn(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  const key        = getColumnKey();
  const iv         = Buffer.from(ivHex,         "hex");
  const authTag    = Buffer.from(authTagHex,    "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher   = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

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
      "SELECT name, email, password_hash, password_history, verified, revoked FROM hospitals WHERE email = $1",
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
      revoked: row.revoked ?? false,
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
    return { name, email: email.toLowerCase(), passwordHash, passwordHistory: [], verified: false, revoked: false };
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

export async function updateHospitalPublicKey(email: string, publicKey: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE hospitals SET rsa_public_key = $1 WHERE email = $2",
      [publicKey, email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

export async function getHospitalPublicKey(email: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT rsa_public_key FROM hospitals WHERE email = $1",
      [email.toLowerCase()]
    );
    return result.rows.length > 0 ? (result.rows[0].rsa_public_key ?? null) : null;
  } finally {
    client.release();
  }
}

export async function updateHospitalWalletAddress(email: string, walletAddress: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE hospitals SET wallet_address = $1 WHERE email = $2",
      [walletAddress, email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

export async function getHospitalWalletAddress(email: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT wallet_address FROM hospitals WHERE email = $1",
      [email.toLowerCase()]
    );
    return result.rows.length > 0 ? (result.rows[0].wallet_address ?? null) : null;
  } finally {
    client.release();
  }
}

export async function getHospitalNameByWallet(walletAddress: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT name FROM hospitals WHERE LOWER(wallet_address) = LOWER($1)",
      [walletAddress]
    );
    return result.rows.length > 0 ? result.rows[0].name : null;
  } finally {
    client.release();
  }
}

export async function markHospitalRevoked(email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE hospitals SET revoked = TRUE WHERE email = $1",
      [email.toLowerCase()]
    );
  } finally {
    client.release();
  }
}

/**
 * Returns the decrypted hospital emails of every hospital with an approved
 * access_request row for this patient. Used by /add-record to build the
 * full encryptedKeys map so every consented hospital can decrypt the record.
 * hospital_email is stored encrypted (Task 4) — each row is decrypted here.
 */
export async function getApprovedHospitalsForPatient(patientId: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT DISTINCT hospital_email FROM access_requests WHERE patient_id = $1 AND status = 'approved'",
      [patientId.toLowerCase()]
    );
    return result.rows.map((row: { hospital_email: string }) => {
      try { return decryptColumn(row.hospital_email); }
      catch { return row.hospital_email; } // fallback: pre-encryption rows stored plain
    });
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
      [patientId.toLowerCase(), encryptColumn(email.toLowerCase())]
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
    if (result.rows.length === 0) return undefined;
    try { return decryptColumn(result.rows[0].email); }
    catch { return result.rows[0].email; } // fallback: pre-encryption rows stored plain
  } finally {
    client.release();
  }
}

export async function deletePatientEmail(patientId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM patient_emails WHERE patient_id = $1", [patientId.toLowerCase()]);
  } finally {
    client.release();
  }
}

// ── Pending submission helpers ────────────────────────────────────────────────
export async function createPendingSubmission(submissionId: string, patientId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO pending_submissions (submission_id, patient_id, status) VALUES ($1, $2, 'pending')",
      [submissionId, patientId.toLowerCase()]
    );
  } finally { client.release(); }
}

export async function completePendingSubmission(submissionId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE pending_submissions SET status = 'completed' WHERE submission_id = $1",
      [submissionId]
    );
  } finally { client.release(); }
}

// Returns the patientId if the row was pending and is now cancelled; null otherwise.
export async function cancelPendingSubmission(submissionId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE pending_submissions SET status = 'cancelled'
       WHERE submission_id = $1 AND status = 'pending'
       RETURNING patient_id`,
      [submissionId]
    );
    return result.rows.length > 0 ? result.rows[0].patient_id : null;
  } finally { client.release(); }
}

// Lazy expiry: cancel any pending rows for this patient older than 3 minutes
// and delete their patient_emails rows. Called at the top of all three
// /add-record/* routes so stale entries are cleaned up without a background job.
export async function expireStaleSubmissions(patientId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE pending_submissions SET status = 'cancelled'
       WHERE patient_id = $1 AND status = 'pending'
         AND created_at < NOW() - INTERVAL '3 minutes'
       RETURNING submission_id`,
      [patientId.toLowerCase()]
    );
    if (result.rows.length > 0) {
      await client.query("DELETE FROM patient_emails WHERE patient_id = $1", [patientId.toLowerCase()]);
    }
  } finally { client.release(); }
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
       WHERE patient_id = $1 AND hospital_email_hash = $2 AND status = 'pending'`,
      [patientId, hashForLookup(hospitalEmail.toLowerCase())]
    );
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + ACCESS_REQUEST_TTL;
    await client.query(
      `INSERT INTO access_requests
         (token, patient_id, patient_email, hospital_name, hospital_email, hospital_email_hash, expires_at, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
      [token, patientId, encryptColumn(patientEmail.toLowerCase()), hospitalName, encryptColumn(hospitalEmail.toLowerCase()), hashForLookup(hospitalEmail.toLowerCase()), expiresAt, now]
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
      patientEmail: (() => { try { return decryptColumn(row.patient_email); } catch { return row.patient_email; } })(),
      hospitalName: row.hospital_name,
      hospitalEmail: (() => { try { return decryptColumn(row.hospital_email); } catch { return row.hospital_email; } })(),
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
       WHERE patient_id = $1 AND hospital_email_hash = $2
       ORDER BY created_at DESC LIMIT 1`,
      [patientId, hashForLookup(hospitalEmail.toLowerCase())]
    );
    if (result.rows.length === 0) return "not_found";
    const { status, expires_at } = result.rows[0];
    if (status === "pending" && Date.now() > Number(expires_at)) {
      await client.query(
        `UPDATE access_requests SET status = 'expired'
         WHERE patient_id = $1 AND hospital_email_hash = $2 AND status = 'pending'`,
        [patientId, hashForLookup(hospitalEmail.toLowerCase())]
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
       WHERE patient_id = $1 AND hospital_email_hash = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [patientId, hashForLookup(hospitalEmail.toLowerCase())]
    );
    if (result.rows.length === 0) return 0;
    return Math.max(0, Number(result.rows[0].expires_at) - Date.now());
  } finally { client.release(); }
}

// ── Revoke token helpers ─────────────────────────────────────────────────────
// Tokens are single-use with no expiry — a patient may revoke access at any
// time after granting it, even long after the original approval.
export async function createRevokeToken(patientId: string, hospitalEmail: string): Promise<string> {
  const token  = crypto.randomBytes(32).toString("hex");
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO revoke_tokens (token, patient_id, hospital_email) VALUES ($1, $2, $3)",
      [token, patientId.toLowerCase(), encryptColumn(hospitalEmail.toLowerCase())]
    );
    return token;
  } finally { client.release(); }
}

// Returns { patientId, hospitalEmail } if the token is valid and unused, then
// marks it used atomically. Returns null if not found or already used.
export async function consumeRevokeToken(
  token: string
): Promise<{ patientId: string; hospitalEmail: string } | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE revoke_tokens SET used = TRUE
       WHERE token = $1 AND used = FALSE
       RETURNING patient_id, hospital_email`,
      [token]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const hospitalEmail = (() => { try { return decryptColumn(row.hospital_email); } catch { return row.hospital_email; } })();
    return { patientId: row.patient_id, hospitalEmail };
  } finally { client.release(); }
}

// ── Keep-alive health check ──────────────────────────────────────────────────
export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
