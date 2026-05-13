/**
 * db.ts — Persistent Hospital Identity Store + Access Request Store
 *
 * Persists to  <project-root>/backend/data/hospitals.json
 * Uses process.cwd() so the path is correct whether the code runs
 * as ts-node (cwd = backend/) or compiled JS from dist/.
 *
 * Atomic writes: data is written to a .tmp file first then renamed,
 * so a crash mid-write never corrupts the live database.
 *
 * Access request tokens and OTPs are intentionally in-memory only —
 * they are short-lived and must NOT survive restarts.
 */

import bcrypt from "bcryptjs";
import fs     from "fs";
import path   from "path";
import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Hospital {
  name:            string;
  email:           string;
  passwordHash:    string;
  passwordHistory: string[];
  verified:        boolean;
}

interface OTPRecord {
  code:      string;
  expiresAt: number;
  purpose:   "signup" | "forgot";
}

/**
 * AccessRequest — models the asynchronous patient authorization request.
 *
 * Each request is tied to:
 *   - A cryptographically secure random token (256-bit)
 *   - A strict 20-minute expiration window
 *   - One-time usability (token deleted on use — prevents replay attacks)
 *
 * This implements the asynchronous, non-blocking coordination model
 * described in the research proposal, aligned with Prof. Chaudhuri's
 * wait-free distributed algorithms and Prof. Shao's Health IT
 * accessibility vs privacy framework.
 */
export interface AccessRequest {
  token:        string;   // Cryptographically secure 256-bit token
  patientId:    string;
  patientEmail: string;
  hospitalName: string;
  hospitalEmail:string;
  expiresAt:    number;   // Unix ms — 20 minutes from creation
  status:       "pending" | "approved" | "denied" | "expired";
  createdAt:    number;
}

// ── File paths ────────────────────────────────────────────────────────────────

function getDataDir(): string {
  return path.join(process.cwd(), "data");
}

function getDbFile(): string {
  return path.join(getDataDir(), "hospitals.json");
}

function getPatientEmailFile(): string {
  return path.join(getDataDir(), "patientEmails.json");
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Load / Save hospitals ─────────────────────────────────────────────────────

function loadHospitals(): Map<string, Hospital> {
  ensureDataDir();
  const file = getDbFile();
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw     = fs.readFileSync(file, "utf8");
    const entries = JSON.parse(raw) as [string, Hospital][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveHospitals(map: Map<string, Hospital>): void {
  ensureDataDir();
  const file = getDbFile();
  const tmp  = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify([...map.entries()], null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// ── Load / Save patient emails ────────────────────────────────────────────────
// patientId → email mapping, persisted to disk

function loadPatientEmails(): Map<string, string> {
  ensureDataDir();
  const file = getPatientEmailFile();
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw     = fs.readFileSync(file, "utf8");
    const entries = JSON.parse(raw) as [string, string][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function savePatientEmails(map: Map<string, string>): void {
  ensureDataDir();
  const file = getPatientEmailFile();
  const tmp  = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify([...map.entries()], null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// ── In-memory state ───────────────────────────────────────────────────────────

const hospitals:     Map<string, Hospital> = loadHospitals();
const patientEmails: Map<string, string>   = loadPatientEmails();
const otpStore       = new Map<string, OTPRecord>();

/**
 * Access request store — keyed by token (256-bit hex string).
 * In-memory only: tokens must not survive server restarts.
 * A restarted server invalidates all pending requests, forcing
 * the hospital to re-initiate — this is correct security behaviour.
 */
const accessRequests = new Map<string, AccessRequest>();

const BCRYPT_ROUNDS      = 12;
const OTP_TTL_MS         = 10 * 60 * 1000;  // 10 minutes
const ACCESS_REQUEST_TTL = 20 * 60 * 1000;  // 20 minutes (per research spec)

// ── Password helpers ──────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function isPasswordReused(
  plain: string, history: string[]
): Promise<boolean> {
  for (const h of history) {
    if (await bcrypt.compare(plain, h)) return true;
  }
  return false;
}

// ── Hospital CRUD ─────────────────────────────────────────────────────────────

export function findHospital(email: string): Hospital | undefined {
  return hospitals.get(email.toLowerCase());
}

export async function createHospital(
  name: string, email: string, plain: string
): Promise<Hospital> {
  const passwordHash = await hashPassword(plain);
  const h: Hospital  = {
    name,
    email:           email.toLowerCase(),
    passwordHash,
    passwordHistory: [],
    verified:        false,
  };
  hospitals.set(email.toLowerCase(), h);
  saveHospitals(hospitals);
  return h;
}

export function markVerified(email: string): void {
  const h = hospitals.get(email.toLowerCase());
  if (!h) return;
  h.verified = true;
  saveHospitals(hospitals);
}

export async function updatePassword(
  email: string, newPlain: string
): Promise<void> {
  const h = hospitals.get(email.toLowerCase());
  if (!h) return;
  h.passwordHistory = [...h.passwordHistory, h.passwordHash].slice(-5);
  h.passwordHash    = await hashPassword(newPlain);
  saveHospitals(hospitals);
}

// ── Patient email store ───────────────────────────────────────────────────────

export function storePatientEmail(patientId: string, email: string): void {
  patientEmails.set(patientId.toLowerCase(), email.toLowerCase());
  savePatientEmails(patientEmails);
}

export function getPatientEmail(patientId: string): string | undefined {
  return patientEmails.get(patientId.toLowerCase());
}

// ── OTP helpers ───────────────────────────────────────────────────────────────

export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function storeOTP(
  email: string, code: string, purpose: "signup" | "forgot"
): void {
  otpStore.set(`${purpose}:${email.toLowerCase()}`, {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    purpose,
  });
}

export function verifyOTP(
  email: string, code: string, purpose: "signup" | "forgot"
): boolean {
  const key    = `${purpose}:${email.toLowerCase()}`;
  const record = otpStore.get(key);
  if (!record)                       return false;
  if (Date.now() > record.expiresAt) { otpStore.delete(key); return false; }
  if (record.code !== code)          return false;
  otpStore.delete(key);
  return true;
}

// ── Access request helpers ────────────────────────────────────────────────────

/**
 * Resolved status store — persists the final status after a token is consumed.
 * Keyed by patientId:hospitalEmail so polling can still find the result
 * after the token has been deleted (one-time use).
 */
const resolvedStatus = new Map<string, "approved" | "denied" | "expired">();

export function createAccessRequest(
  patientId:    string,
  patientEmail: string,
  hospitalName: string,
  hospitalEmail:string
): AccessRequest {
  // Invalidate any existing pending request AND clear resolved status
  // for this patient+hospital pair to allow fresh requests
  const resolvedKey = `${patientId}:${hospitalEmail.toLowerCase()}`;
  resolvedStatus.delete(resolvedKey);
  for (const [key, req] of accessRequests.entries()) {
    if (
      req.patientId     === patientId &&
      req.hospitalEmail === hospitalEmail.toLowerCase() &&
      req.status        === "pending"
    ) {
      accessRequests.delete(key);
    }
  }

  const token   = crypto.randomBytes(32).toString("hex"); // 256-bit secure token
  const request: AccessRequest = {
    token,
    patientId,
    patientEmail: patientEmail.toLowerCase(),
    hospitalName,
    hospitalEmail: hospitalEmail.toLowerCase(),
    expiresAt:    Date.now() + ACCESS_REQUEST_TTL,
    status:       "pending",
    createdAt:    Date.now(),
  };
  accessRequests.set(token, request);
  return request;
}

export function getAccessRequest(token: string): AccessRequest | undefined {
  return accessRequests.get(token);
}

/**
 * Validates and consumes a token (one-time use).
 * Returns the request if valid and pending, null otherwise.
 * Marks expired tokens as "expired" before returning null.
 */
export function consumeAccessToken(
  token: string,
  action: "approved" | "denied"
): AccessRequest | null {
  const req = accessRequests.get(token);
  if (!req)                    return null;
  if (req.status !== "pending") return null;
  if (Date.now() > req.expiresAt) {
    req.status = "expired";
    return null;
  }
  req.status = action;
  // Persist final status so polling endpoint can still find it after deletion
  const resolvedKey = `${req.patientId}:${req.hospitalEmail}`;
  resolvedStatus.set(resolvedKey, action);
  // Token consumed — delete to prevent replay attacks
  accessRequests.delete(token);
  return req;
}

/**
 * Checks the current status of a pending access request for a
 * patient+hospital pair. Used by the hospital's polling endpoint.
 */
export function checkAccessStatus(
  patientId:    string,
  hospitalEmail: string
): "pending" | "approved" | "denied" | "expired" | "not_found" {
  // First check resolved status (token already consumed)
  const resolvedKey = `${patientId}:${hospitalEmail.toLowerCase()}`;
  const resolved = resolvedStatus.get(resolvedKey);
  if (resolved) return resolved;

  // Then check active pending requests
  for (const req of accessRequests.values()) {
    if (
      req.patientId     === patientId &&
      req.hospitalEmail === hospitalEmail.toLowerCase()
    ) {
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

/**
 * Returns milliseconds remaining for a pending request.
 * Used by the frontend countdown timer.
 */
export function getAccessRequestTimeRemaining(
  patientId:    string,
  hospitalEmail: string
): number {
  for (const req of accessRequests.values()) {
    if (
      req.patientId     === patientId &&
      req.hospitalEmail === hospitalEmail.toLowerCase() &&
      req.status        === "pending"
    ) {
      return Math.max(0, req.expiresAt - Date.now());
    }
  }
  return 0;
}
