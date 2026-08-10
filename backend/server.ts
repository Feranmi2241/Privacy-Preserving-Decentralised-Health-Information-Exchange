// ── Load env FIRST ────────────────────────────────────────────────────────────
import * as dotenv from "dotenv";
dotenv.config();

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED_ENV: string[] = [
  "DATABASE_URL",
  "RPC_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS",
  "PINATA_JWT", "PINATA_GATEWAY",
  "SESSION_SECRET",
  "DB_ENCRYPTION_KEY", "DB_HASH_KEY",
  "ADMIN_SECRET",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `\n[STARTUP ERROR] Missing required environment variables:\n  ${missing.join("\n  ")}\n` +
    `Please set them in backend/.env before starting the server.\n`
  );
  process.exit(1);
}
if (!process.env.SENDGRID_API_KEY) {
  console.warn("[STARTUP WARN] SENDGRID_API_KEY not set — emails will fail.");
}

// Warn if BACKEND_URL is still pointing to localhost in a likely production environment
const backendUrl = process.env.BACKEND_URL || "";
if (!backendUrl || backendUrl.includes("localhost")) {
  console.warn(
    "[STARTUP WARN] BACKEND_URL is not set or points to localhost.\n" +
    "  Patient approve/deny email links will NOT work after deployment.\n" +
    "  Set BACKEND_URL to your deployed backend URL in backend/.env\n" +
    "  Example: BACKEND_URL=https://your-app.railway.app"
  );
}

// ── Imports ───────────────────────────────────────────────────────────────────
import express, { Request, Response, NextFunction } from "express";
import cors       from "cors";
import helmet     from "helmet";
import crypto     from "crypto";
import rateLimit  from "express-rate-limit";
import { PinataSDK } from "pinata";
import { ethers }    from "ethers";
import contract, { provider } from "./blockchain";
import { keccak256, toUtf8Bytes } from "ethers";

function hashPatientId(patientId: string): string {
  return keccak256(toUtf8Bytes(patientId.trim().toLowerCase()));
}
import { encryptRecord, decryptRecord, EncryptedPayload, generateRSAKeyPair } from "./encryption";
import { getOrCreateRegister, getRegisterHistory } from "./waitFreeRegister";
import {
  findHospital, createHospital, markVerified, updatePassword,
  generateOTP, storeOTP, verifyOTP, isPasswordReused, verifyPassword,
  storePatientEmail, getPatientEmail,
  createAccessRequest, consumeAccessToken,
  checkAccessStatus, getAccessRequestTimeRemaining,
  initializeDatabase, updateHospitalPublicKey,
  getHospitalPublicKey, getApprovedHospitalsForPatient,
  updateHospitalWalletAddress, getHospitalWalletAddress,
  markHospitalRevoked,
  deletePatientEmail,
  createPendingSubmission, completePendingSubmission,
  cancelPendingSubmission, expireStaleSubmissions,
  createRevokeToken, consumeRevokeToken,
} from "./dbPostgres";
import {
  sendSignupOTP, sendForgotOTP, sendRecordStoredNotification,
  sendPatientAuthorizationRequest,
  sendPatientAccessConfirmation,
  sendAccessGrantedNotification, sendAccessDeniedNotification,
} from "./mailer";
import { signToken, verifyToken, STRONG_PASSWORD_REGEX } from "./auth";

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
app.set('trust proxy', 1);

const PORT = parseInt(process.env.PORT || "5000", 10);
// Strip trailing slash — CORS origin matching is exact, a trailing slash
// causes every cross-origin request to be rejected in production.
const allowedOrigin = (process.env.ALLOWED_ORIGIN || "http://localhost:5173").replace(/\/$/, "");

app.use(helmet({
  // Allow inline styles for the access response HTML page
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
    },
  },
}));
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "20mb" }));

const pinata = new PinataSDK({
  pinataJwt:     process.env.PINATA_JWT     as string,
  pinataGateway: process.env.PINATA_GATEWAY as string,
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many OTP attempts. Please try again in 10 minutes." },
});
const accessLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many access requests. Please wait before retrying." },
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "Clinical Ledger HIE Backend" });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token   = req.headers.authorization?.split(" ")[1];
  const decoded = token ? verifyToken(token) : null;
  if (!decoded) { res.status(401).json({ error: "Unauthorised" }); return; }
  res.locals.user = decoded;
  // Check revoked flag on every authenticated request
  findHospital(decoded.email).then((hospital) => {
    if (!hospital || hospital.revoked) {
      res.status(403).json({ error: "This hospital's access has been revoked" }); return;
    }
    next();
  }).catch(() => {
    res.status(500).json({ error: "Internal server error" });
  });
}

// ── POST /auth/register ───────────────────────────────────────────────────────
app.post("/auth/register", authLimiter, async (req: Request, res: Response) => {
  const { name, email, password, termsAccepted } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email and password are required" }); return;
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
    res.status(400).json({ error: "Name must be between 1 and 100 characters" }); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    res.status(400).json({ error: "Invalid email address" }); return;
  }
  if (!termsAccepted) {
    res.status(400).json({ error: "You must accept the governance terms to register" }); return;
  }
  if (!STRONG_PASSWORD_REGEX.test(password)) {
    res.status(400).json({ error: "Password must be ≥8 chars with upper, lower, digit and special character" }); return;
  }
  if (await findHospital(email)) {
    res.status(409).json({ error: "Email already registered" }); return;
  }
  await createHospital(name, email, password);
  const code = generateOTP();
  await storeOTP(email, code, "signup");
  try { await sendSignupOTP(email, code); } catch (e: any) { console.warn("[mailer]", e.message); }
  res.json({ message: "OTP sent to email" });
});

// ── POST /auth/verify-otp ─────────────────────────────────────────────────────
app.post("/auth/verify-otp", otpLimiter, async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!await verifyOTP(email, code, "signup")) {
    res.status(400).json({ error: "Invalid or expired OTP" }); return;
  }
  await markVerified(email);

  // Generate a per-hospital RSA keypair at the moment the account is confirmed.
  // The public key is stored in the DB for encrypting this hospital's records.
  // The private key is returned ONCE here and never stored — the hospital must
  // save it immediately; it cannot be recovered if lost.
  const { publicKey, privateKey } = generateRSAKeyPair();
  await updateHospitalPublicKey(email, publicKey);

  res.json({
    message:      "Email verified",
    rsaPrivateKey: privateKey,
    keyWarning:   "Save this private key somewhere safe right now — it will never be shown again, and you will need it to view any patient record you're given access to.",
  });
});
// ── POST /auth/login ──────────────────────────────────────────────────────────
app.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const hospital = await findHospital(email);
  if (!hospital || !(await verifyPassword(password, hospital.passwordHash))) {
    res.status(401).json({ error: "Invalid credentials" }); return;
  }
  if (!hospital.verified) {
    res.status(403).json({ error: "Email not verified" }); return;
  }
  const token = signToken(email, hospital.name);
  res.json({ token, hospitalName: hospital.name });
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
app.post("/auth/forgot-password", authLimiter, async (req: Request, res: Response) => {
  const { email } = req.body;
  const hospital  = await findHospital(email);
  if (!hospital) { res.json({ message: "If that email exists, an OTP was sent" }); return; }
  const code = generateOTP();
  await storeOTP(email, code, "forgot");
  try { await sendForgotOTP(email, code); } catch (e: any) { console.warn("[mailer]", e.message); }
  res.json({ message: "If that email exists, an OTP was sent" });
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
app.post("/auth/reset-password", otpLimiter, async (req: Request, res: Response) => {
  const { email, code, newPassword } = req.body;
  if (!await verifyOTP(email, code, "forgot")) {
    res.status(400).json({ error: "Invalid or expired OTP" }); return;
  }
  if (!STRONG_PASSWORD_REGEX.test(newPassword)) {
    res.status(400).json({ error: "Password does not meet strength requirements" }); return;
  }
  const hospital = await findHospital(email);
  if (!hospital) { res.status(404).json({ error: "User not found" }); return; }
  if (await isPasswordReused(newPassword, hospital.passwordHistory)) {
    res.status(400).json({ error: "Password was used before" }); return;
  }
  await updatePassword(email, newPassword);
  await markVerified(email);
  res.json({ message: "Password reset successful" });
});

// ── Wallet nonce store (in-memory, TTL 5 min) ───────────────────────────────
const walletNonces = new Map<string, { nonce: string; expiresAt: number }>();

// ── POST /auth/wallet-nonce ───────────────────────────────────────────────────
app.post("/auth/wallet-nonce", requireAuth, async (req: Request, res: Response) => {
  const email = (res.locals.user as { email: string }).email;
  const nonce = crypto.randomBytes(16).toString("hex");
  walletNonces.set(email, { nonce, expiresAt: Date.now() + 5 * 60 * 1000 });
  res.json({ message: `Sign this message to link your wallet to ${email}. Nonce: ${nonce}` });
});

// ── POST /auth/wallet-verify ──────────────────────────────────────────────────
app.post("/auth/wallet-verify", requireAuth, async (req: Request, res: Response) => {
  const email = (res.locals.user as { email: string }).email;
  const { walletAddress, signature } = req.body;

  if (!walletAddress || !signature) {
    res.status(400).json({ error: "walletAddress and signature are required" }); return;
  }

  const stored = walletNonces.get(email);
  if (!stored || Date.now() > stored.expiresAt) {
    walletNonces.delete(email);
    res.status(401).json({ error: "Nonce expired or not found — request a new one" }); return;
  }

  const message = `Sign this message to link your wallet to ${email}. Nonce: ${stored.nonce}`;
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    res.status(401).json({ error: "Invalid signature" }); return;
  }

  if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
    res.status(401).json({ error: "Signature does not match the claimed wallet address" }); return;
  }

  // Nonce consumed — delete before any await to prevent replay
  walletNonces.delete(email);

  await updateHospitalWalletAddress(email, walletAddress);

  // Authorize the hospital's wallet on-chain via the deployer (owner) contract instance.
  // This is an intentional, acceptable centralization point — the deployer is the admin
  // who approves new hospital nodes, same as any permissioned network's admin role.
  try {
    const tx = await contract.authorizeHospital(walletAddress);
    await tx.wait();
  } catch (err: any) {
    console.error("[wallet-verify] authorizeHospital failed:", err.message);
    res.status(500).json({ error: "Failed to authorize wallet on-chain" }); return;
  }

  res.json({ success: true, walletAddress });
});

// ── POST /admin/verify-email (temporary) ─────────────────────────────────────
app.post("/admin/verify-email", authLimiter, async (req: Request, res: Response) => {
  const { secret, email } = req.body;
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Valid email is required" }); return;
  }
  const provided = Buffer.from(typeof secret === "string" ? secret : "");
  const expected = Buffer.from(process.env.SESSION_SECRET!);
  const match = provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);
  if (!match) { res.status(403).json({ error: "Forbidden" }); return; }
  await markVerified(email);
  res.json({ message: `${email} marked as verified` });
});

// ── POST /admin/revoke-hospital ───────────────────────────────────────────────
app.post("/admin/revoke-hospital", async (req: Request, res: Response) => {
  const { email, adminSecret } = req.body;
  if (!email || !adminSecret) {
    res.status(400).json({ error: "email and adminSecret are required" }); return;
  }
  if (adminSecret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid admin secret" }); return;
  }
  const walletAddress = await getHospitalWalletAddress(email);
  if (!walletAddress) {
    res.status(404).json({ error: "Hospital not found or has no wallet address" }); return;
  }
  try {
    const tx = await contract.revokeHospital(walletAddress);
    await tx.wait();
  } catch (err: any) {
    console.error("[admin/revoke-hospital] revokeHospital failed:", err.message);
    res.status(500).json({ error: "Failed to revoke hospital on-chain" }); return;
  }
  await markHospitalRevoked(email);
  res.json({ success: true, email, walletAddress });
});

// ── GET /network/status ───────────────────────────────────────────────────────
app.get("/network/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const provider    = (contract.runner as any).provider as ethers.JsonRpcProvider;
    const blockNumber = await provider.getBlockNumber();
    const network     = await provider.getNetwork();
    const block       = await provider.getBlock(blockNumber);
    res.json({
      blockNumber,
      chainId:       network.chainId.toString(),
      networkName:   network.name || "ganache",
      lastBlockHash: block?.hash   ?? "unavailable",
      timestamp:     block?.timestamp ?? 0,
      nodeStatus:    "operational",
    });
  } catch (err: any) { console.error("[network/status]", err); res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /records/all ──────────────────────────────────────────────────────────
app.get("/records/all", requireAuth, async (_req: Request, res: Response) => {
  try {
    const ids: string[] = await contract.getAllPatientIds();
    res.json({ total: ids.length, patientIds: ids });
  } catch (error: any) { console.error("[records/all]", error); res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /add-record/prepare ──────────────────────────────────────────────────
app.post("/add-record/prepare", requireAuth, express.json({ limit: "20mb" }), async (req: Request, res: Response) => {
  try {
    const {
      patientId, fullName, dateOfBirth, patientEmail,
      phone, address,
      allergies, existingConditions, bloodGroup,
      symptoms, diagnosis,
      medication, dosage, instructions,
      doctorName, department,
      profilePhoto, previousIpfsHash,
    } = req.body;

    // Patient ID is always required
    if (typeof patientId !== "string" || patientId.trim().length === 0) {
      res.status(400).json({ error: "Missing or invalid field: patientId" }); return;
    }
    if (!/^[A-Za-z0-9\-]+$/.test(patientId.trim())) {
      res.status(400).json({ error: "Patient ID may only contain letters, digits and hyphens" }); return;
    }

    // Lazy expiry: clean up any stale pending submissions for this patient
    // before doing anything else, so orphaned patient_emails rows are removed.
    await expireStaleSubmissions(patientId.trim().toLowerCase());

    const isAmendment = typeof previousIpfsHash === "string" && previousIpfsHash.trim().length > 0;
    const prevHash    = isAmendment ? previousIpfsHash.trim() : "";

    // Encounter fields are required on every submission (first record AND amendment)
    const encounterFields: Record<string, string> = {
      symptoms, diagnosis, medication, dosage, instructions, doctorName, department,
    };
    for (const [key, val] of Object.entries(encounterFields)) {
      if (typeof val !== "string" || val.trim().length === 0) {
        res.status(400).json({ error: `Missing or invalid field: ${key}` }); return;
      }
    }

    // ── Profile fields: required on first record, must be supplied by frontend on amendment ──
    let resolvedFullName      = typeof fullName      === "string" ? fullName.trim()      : "";
    let resolvedDateOfBirth   = typeof dateOfBirth   === "string" ? dateOfBirth.trim()   : "";
    let resolvedPatientEmail  = typeof patientEmail  === "string" ? patientEmail.trim().toLowerCase()  : "";
    let resolvedPhone         = typeof phone         === "string" ? phone.trim()         : "";
    let resolvedAddress       = typeof address       === "string" ? address.trim()       : "";
    let resolvedBloodGroup    = typeof bloodGroup    === "string" ? bloodGroup.trim()    : "";
    let resolvedProfilePhoto  = (profilePhoto && typeof profilePhoto === "string") ? profilePhoto : "";
    let resolvedAllergies     = typeof allergies          === "string" ? allergies.trim()          : "";
    let resolvedConditions    = typeof existingConditions === "string" ? existingConditions.trim() : "";

    if (isAmendment) {
      // Profile fields must be pre-resolved by the frontend (fetched + decrypted browser-side).
      // The backend no longer decrypts the previous version — private key never leaves the client.
      const profileFields: Record<string, string> = {
        fullName: resolvedFullName, dateOfBirth: resolvedDateOfBirth,
        patientEmail: resolvedPatientEmail, phone: resolvedPhone,
        address: resolvedAddress, bloodGroup: resolvedBloodGroup,
      };
      for (const [key, val] of Object.entries(profileFields)) {
        if (!val) { res.status(400).json({ error: `Missing resolved profile field for amendment: ${key}` }); return; }
      }
    } else {
      // First record — all Profile fields are required
      const profileFields: Record<string, string> = {
        fullName: resolvedFullName, dateOfBirth: resolvedDateOfBirth,
        patientEmail: resolvedPatientEmail, phone: resolvedPhone,
        address: resolvedAddress, bloodGroup: resolvedBloodGroup,
      };
      for (const [key, val] of Object.entries(profileFields)) {
        if (!val) { res.status(400).json({ error: `Missing or invalid field: ${key}` }); return; }
      }
      // Patient email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedPatientEmail)) {
        res.status(400).json({ error: "Invalid patient email address" }); return;
      }
    }

    // Profile photo validation (only when a new photo is supplied)
    if (resolvedProfilePhoto && resolvedProfilePhoto.startsWith("data:image/")) {
      if (resolvedProfilePhoto.length > 8 * 1024 * 1024) {
        res.status(400).json({ error: "Profile photo exceeds maximum size (8 MB)" }); return;
      }
    } else if (resolvedProfilePhoto && !resolvedProfilePhoto.startsWith("data:image/")) {
      // Could be a carried-over base64 from previous version — allow it through
      // Only reject if it looks like a fresh upload with a wrong prefix
      if (profilePhoto && typeof profilePhoto === "string" && !profilePhoto.startsWith("data:image/")) {
        res.status(400).json({ error: "Invalid profile photo format" }); return;
      }
    }

    const record = {
      patientId:          patientId.trim().toLowerCase(),
      fullName:           resolvedFullName,
      dateOfBirth:        resolvedDateOfBirth,
      patientEmail:       resolvedPatientEmail,
      phone:              resolvedPhone,
      address:            resolvedAddress,
      allergies:          resolvedAllergies,
      existingConditions: resolvedConditions,
      bloodGroup:         resolvedBloodGroup,
      symptoms:           symptoms.trim(),
      diagnosis:          diagnosis.trim(),
      medication:         medication.trim(),
      dosage:             dosage.trim(),
      instructions:       instructions.trim(),
      doctorName:         doctorName.trim(),
      department:         department.trim(),
      profilePhoto:       resolvedProfilePhoto,
    };

    // Check whether this patient already has a stored email row — determines
    // whether this is a genuinely new patient (needed for submissionId tracking).
    const existingEmail = await getPatientEmail(patientId.trim().toLowerCase());
    const isNewPatient  = !existingEmail;

    // Persist patient email for future access requests
    if (resolvedPatientEmail) {
      await storePatientEmail(patientId.trim().toLowerCase(), resolvedPatientEmail);
    }

    // Hybrid-encrypt (AES-256-GCM + RSA-OAEP) for every consented hospital
    // Build publicKeys map: submitting hospital + every previously approved hospital
    const submittingEmail = res.locals.user.email as string;
    const approvedEmails  = await getApprovedHospitalsForPatient(patientId.trim().toLowerCase());
    const allEmails       = Array.from(new Set([submittingEmail, ...approvedEmails]));

    const publicKeys: Record<string, string> = {};
    for (const email of allEmails) {
      const pubKey = await getHospitalPublicKey(email);
      if (!pubKey) {
        console.warn(`[add-record] Skipping encryptedKey for ${email} — no rsa_public_key on file (pre-phase-1 account, see MIGRATION_NOTE.md)`);
        continue;
      }
      publicKeys[email] = pubKey;
    }

    const payload: EncryptedPayload = encryptRecord(JSON.stringify(record), publicKeys);

    // Pin to IPFS
    const pinResult = await pinata.upload.public.json(payload);
    const ipfsHash  = pinResult.cid;

    const hashed = hashPatientId(patientId);

    // For new patients only: persist a pending_submissions row so /add-record/cancel
    // can safely roll back the patient_emails row if the wallet tx never completes.
    let submissionId: string | undefined;
    if (isNewPatient) {
      submissionId = crypto.randomBytes(16).toString("hex");
      await createPendingSubmission(submissionId, patientId.trim().toLowerCase());
    }

    const response: Record<string, string> = {
      ipfsHash,
      previousIpfsHash: prevHash,
      hashedPatientId:  hashed,
    };
    if (submissionId) response.submissionId = submissionId;

    res.json(response);
  } catch (error: any) {
    console.error("[add-record/prepare]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Helper: verify a storeRecord tx actually landed on-chain ────────────────
/**
 * Independently verifies that txHash:
 *   1. Exists and succeeded (not reverted)
 *   2. Was sent to our CONTRACT_ADDRESS
 *   3. Was signed by the wallet on file for expectedHospitalEmail
 *
 * Returns null on success, or an error string describing what failed.
 */
async function verifyStoreRecordTx(
  txHash: string,
  expectedHospitalEmail: string
): Promise<string | null> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return "Transaction not found — it may not have confirmed yet";
  }
  if (receipt.status !== 1) {
    return "Transaction was reverted on-chain";
  }
  const contractAddress = process.env.CONTRACT_ADDRESS!;
  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    return `Transaction was not sent to the expected contract (got ${receipt.to})`;
  }
  const storedWallet = await getHospitalWalletAddress(expectedHospitalEmail);
  if (!storedWallet) {
    return "No wallet address on file for this hospital — complete wallet linking first";
  }
  if (receipt.from.toLowerCase() !== storedWallet.toLowerCase()) {
    return `Transaction sender (${receipt.from}) does not match the wallet on file for this hospital`;
  }
  return null;
}

// ── POST /add-record/confirm ─────────────────────────────────────────────────
app.post("/add-record/confirm", requireAuth, async (req: Request, res: Response) => {
  const { patientId, txHash, ipfsHash, submissionId } = req.body;

  if (!patientId || !txHash || !ipfsHash) {
    res.status(400).json({ error: "patientId, txHash and ipfsHash are required" }); return;
  }
  if (typeof patientId !== "string" || !/^[A-Za-z0-9\-]+$/.test(patientId.trim())) {
    res.status(400).json({ error: "Invalid patientId" }); return;
  }

  try {
    // Lazy expiry before processing
    await expireStaleSubmissions(patientId.trim().toLowerCase());

    // Independently verify the transaction before trusting anything the client says.
    const user = res.locals.user as { email: string };
    const txError = await verifyStoreRecordTx(txHash, user.email);
    if (txError) {
      res.status(400).json({ error: `Transaction verification failed: ${txError}` }); return;
    }

    // Independently verify the client-supplied ipfsHash against the chain.
    // getIpfsHash() returns the latest stored CID — if it matches what the
    // frontend claims, the transaction genuinely landed with that payload.
    // This prevents a malicious or buggy client from triggering confirmation
    // emails for a hash that was never actually stored on-chain.
    let onChainHash: string;
    try {
      onChainHash = await contract.getIpfsHash(hashPatientId(patientId));
    } catch (err: any) {
      if (err.reason && err.reason.includes("Record not found")) {
        res.status(404).json({ error: "Record not found on blockchain — transaction may not have confirmed yet" }); return;
      }
      throw err;
    }

    if (onChainHash !== ipfsHash) {
      res.status(409).json({ error: "ipfsHash does not match the latest record on-chain" }); return;
    }

    const pid            = patientId.trim().toLowerCase();
    const newVersion     = Number(await contract.getRecordCount(hashPatientId(patientId)));
    const encounterLabel = newVersion === 1 ? "Initial Record" : `Encounter ${newVersion - 1}`;

    // Resolve fullName and patientEmail for notification emails.
    let fullName     = "";
    let patientEmail = "";

    if (submissionId && typeof submissionId === "string") {
      // Mark completed in DB — this prevents cancel from rolling back the email row
      await completePendingSubmission(submissionId);
    }

    // Patient email is already in patient_emails (written by /prepare)
    patientEmail = (await getPatientEmail(pid)) ?? "";

    // Hospital confirmation email
    try {
      await sendRecordStoredNotification(user.email, pid, txHash, ipfsHash, fullName, encounterLabel);
    } catch (e: any) { console.warn("[mailer]", e.message); }

    // Patient confirmation email
    if (patientEmail) {
      try {
        await sendRecordStoredNotification(patientEmail, pid, txHash, ipfsHash, fullName, encounterLabel);
      } catch (e: any) { console.warn("[mailer] patient notification failed:", e.message); }
    }

    res.json({ success: true, txHash, ipfsHash });
  } catch (error: any) {
    console.error("[add-record/confirm]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /add-record/cancel ──────────────────────────────────────────────────
app.post("/add-record/cancel", requireAuth, async (req: Request, res: Response) => {
  const { submissionId } = req.body;
  if (!submissionId || typeof submissionId !== "string") {
    res.status(400).json({ error: "submissionId is required" }); return;
  }
  try {
    // cancelPendingSubmission returns the patientId only when the row was
    // genuinely pending — meaning this submission created the patient_emails row.
    // If already completed or cancelled, it returns null and we do nothing.
    const patientId = await cancelPendingSubmission(submissionId);
    if (patientId) {
      await deletePatientEmail(patientId);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("[add-record/cancel]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /access/request ──────────────────────────────────────────────────────
/**
 * Hospital submits a patientId to request access.
 * The backend resolves the current on-chain hash itself via getIpfsHash(),
 * so no client-supplied txHash/ipfsCid is needed — this works correctly
 * across multiple encounters where each version has a different hash.
 *
 * This implements the asynchronous access control model:
 *   - Decentralized data ownership (patient decides)
 *   - Cryptographic token enforcement (256-bit secure token)
 *   - Non-blocking coordination (hospital polls for status)
 *   - Wait-free register write (consent state updated atomically)
 */
app.post("/access/request", requireAuth, accessLimiter, async (req: Request, res: Response) => {
  const { patientId } = req.body;

  if (!patientId) {
    res.status(400).json({ error: "patientId is required" }); return;
  }
  if (!/^[A-Za-z0-9\-]+$/.test(patientId.trim())) {
    res.status(400).json({ error: "Invalid patient ID format" }); return;
  }

  try {
    // Step 1: Confirm the patient record exists on-chain
    // getIpfsHash() always returns the latest version's hash — no client hash needed.
    try {
      await contract.getIpfsHash(hashPatientId(patientId));
    } catch (err: any) {
      if (err.reason && err.reason.includes("Record not found")) {
        res.status(404).json({ error: "Record not found on blockchain" }); return;
      }
      throw err;
    }

    // Step 2: Look up patient email
    const patientEmail = await getPatientEmail(patientId.trim().toLowerCase());
    if (!patientEmail) {
      res.status(404).json({ error: "Patient email not found. Record may have been stored before this feature was added." });
      return;
    }

    // Step 3: Create cryptographically secure access request token
    const user    = res.locals.user as { email: string; hospitalName: string };
    const request = await createAccessRequest(
      patientId.trim().toLowerCase(),
      patientEmail,
      user.hospitalName,
      user.email
    );

    // Step 4: Write "pending" to the wait-free register for this patient
    // This models the asynchronous consent state update in the distributed system
    const register = getOrCreateRegister(patientId.trim().toLowerCase());
    register.write("pending", user.email);

    // Step 5: Send authorization email to patient
    try {
      await sendPatientAuthorizationRequest(
        patientEmail,
        patientId.trim().toLowerCase(),
        user.hospitalName,
        request.token,
        request.expiresAt
      );
    } catch (e: any) {
      console.warn("[mailer] sendPatientAuthorizationRequest failed:", e.message);
    }

    res.json({
      message:      "Authorization request sent to patient",
      expiresAt:    request.expiresAt,
      patientEmail: patientEmail.replace(/(.{2}).*(@.*)/, "$1***$2"), // masked
    });
  } catch (err: any) {
    console.error("[access/request]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /access/status ────────────────────────────────────────────────────────
/**
 * Hospital polls this endpoint to check if the patient has responded.
 * Returns: pending | approved | denied | expired | not_found
 *
 * This is the non-blocking polling mechanism that allows the hospital
 * interface to transition automatically when the patient approves —
 * demonstrating asynchronous coordination without a persistent UI.
 */
app.get("/access/status", requireAuth, async (req: Request, res: Response) => {
  const { patientId } = req.query as { patientId?: string };
  if (!patientId) { res.status(400).json({ error: "patientId is required" }); return; }

  const user          = res.locals.user as { email: string };
  const pid           = String(patientId).trim().toLowerCase();
  const status        = await checkAccessStatus(pid, user.email);
  const timeRemaining = await getAccessRequestTimeRemaining(pid, user.email);

  // Read from wait-free register — models distributed consent state check
  const register      = getOrCreateRegister(pid);
  const registerState = register.read(user.email);

  res.json({ status, timeRemaining, registerState });
});

// ── GET /access/respond ───────────────────────────────────────────────────────
/**
 * Patient clicks Approve or Deny link in their email.
 * This endpoint:
 *   1. Validates and consumes the one-time token
 *   2. Updates the blockchain consent layer (approve only)
 *   3. Writes the final state to the wait-free register
 *   4. Sends notification emails to the hospital
 *   5. Returns a human-readable HTML response page
 *
 * This is a GET endpoint because it is triggered by clicking a link
 * in an email — the browser navigates directly to this URL.
 */
app.get("/access/respond", async (req: Request, res: Response) => {
  const { token, action } = req.query as { token?: string; action?: string };

  if (!token || (action !== "approved" && action !== "denied")) {
    res.status(400).send(responseHtml("❌ Invalid Request",
      "This authorization link is invalid or malformed.",
      "#ba1a1a"));
    return;
  }

  const request = await consumeAccessToken(token, action);

  if (!request) {
    res.status(410).send(responseHtml("⏰ Link Expired or Already Used",
      "This authorization link has already been used or has expired. " +
      "The hospital may send a new request from the Clinical Ledger HIE dashboard.",
      "#f59e0b"));
    return;
  }

  try {
    if (action === "approved") {
      // Grant consent on-chain for the specific hospital wallet that requested access.
      // grantConsent is called by the deployer (owner) on behalf of the requesting hospital,
      // authorising that hospital's wallet address in the contract's patientConsent mapping.
      const hospitalAddress = await getHospitalWalletAddress(request.hospitalEmail);
      if (!hospitalAddress) {
        res.status(500).send(responseHtml("⚠️ Unable to Complete Approval",
          "The requesting hospital's account is not fully set up yet. Please contact the hospital directly.",
          "#f59e0b"));
        return;
      }
      await contract.grantConsent(hashPatientId(request.patientId), hospitalAddress);

      // Write "approved" to wait-free register — atomic, wait-free
      const register = getOrCreateRegister(request.patientId);
      register.write("approved", "patient");

      // Notify hospital
      try {
        await sendAccessGrantedNotification(
          request.hospitalEmail,
          request.hospitalName,
          request.patientId
        );
      } catch (e: any) { console.warn("[mailer]", e.message); }

      // Notify patient with a single-use revoke link
      try {
        const revokeToken = await createRevokeToken(request.patientId, request.hospitalEmail);
        const revokeLink  = `${process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`}/access/revoke-respond?token=${revokeToken}`;
        await sendPatientAccessConfirmation(
          request.patientEmail,
          request.patientId,
          request.hospitalName,
          revokeLink
        );
      } catch (e: any) { console.warn("[mailer] sendPatientAccessConfirmation failed:", e.message); }

      res.send(responseHtml("✅ Access Approved",
        `You have approved access for <strong>${escapeHtml(request.hospitalName)}</strong> ` +
        `to your medical record (Patient ID: <code>${escapeHtml(request.patientId)}</code>). ` +
        `The healthcare provider has been notified and can now access your record. ` +
        `You may close this window.`,
        "#00464a"));
    } else {
      // Write "denied" to wait-free register
      const register = getOrCreateRegister(request.patientId);
      register.write("denied", "patient");

      // Notify hospital
      try {
        await sendAccessDeniedNotification(
          request.hospitalEmail,
          request.hospitalName,
          request.patientId,
          "denied"
        );
      } catch (e: any) { console.warn("[mailer]", e.message); }

      res.send(responseHtml("❌ Access Denied",
        `You have denied access for <strong>${escapeHtml(request.hospitalName)}</strong> ` +
        `to your medical record (Patient ID: <code>${escapeHtml(request.patientId)}</code>). ` +
        `The healthcare provider has been notified. ` +
        `Your data remains private and secure. You may close this window.`,
        "#ba1a1a"));
    }
  } catch (err: any) {
    console.error("[access/respond]", err);
    res.status(500).send(responseHtml("⚠️ System Error",
      "An error occurred while processing your response. Please try again.",
      "#f59e0b"));
  }
});

// ── GET /access/revoke-respond ──────────────────────────────────────────────────────
/**
 * Patient clicks the revoke link from their access-confirmation email.
 * Validates and consumes the single-use token, resolves the hospital wallet,
 * calls revokeConsent on-chain, and returns a confirmation HTML page.
 */
app.get("/access/revoke-respond", async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).send(responseHtml("❌ Invalid Request",
      "This revoke link is invalid or malformed.",
      "#ba1a1a"));
    return;
  }

  const record = await consumeRevokeToken(token);
  if (!record) {
    res.status(410).send(responseHtml("⏰ Link Already Used",
      "This revoke link has already been used. " +
      "If you still want to revoke access, please contact the system administrator.",
      "#f59e0b"));
    return;
  }

  try {
    const hospitalAddress = await getHospitalWalletAddress(record.hospitalEmail);
    if (!hospitalAddress) {
      res.status(500).send(responseHtml("⚠️ Unable to Revoke",
        "The hospital's wallet address could not be found. Please contact the system administrator.",
        "#f59e0b"));
      return;
    }

    await contract.revokeConsent(hashPatientId(record.patientId), hospitalAddress);

    res.send(responseHtml("🚫 Access Revoked",
      `You have successfully revoked access for the hospital associated with ` +
      `Patient ID: <code>${escapeHtml(record.patientId)}</code>. ` +
      `They can no longer retrieve your medical record. You may close this window.`,
      "#ba1a1a"));
  } catch (err: any) {
    console.error("[access/revoke-respond]", err);
    res.status(500).send(responseHtml("⚠️ System Error",
      "An error occurred while revoking access. Please try again.",
      "#f59e0b"));
  }
});

// ── GET /register/history/:patientId ─────────────────────────────────────────
/**
 * Returns the full wait-free register history for a patient.
 * Demonstrates the immutable audit trail of all consent state transitions —
 * aligned with Prof. Chaudhuri's distributed algorithms research and
 * Prof. Zhan's information assurance requirements.
 */
app.get("/register/history/:patientId", requireAuth, (req: Request, res: Response) => {
  const patientId = String(req.params.patientId);
  const history   = getRegisterHistory(patientId);
  res.json({ patientId, history });
});

// ── HTML helpers ─────────────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function responseHtml(title: string, message: string, color: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title} — Clinical Ledger HIE</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Inter,Arial,sans-serif;background:#f6fafe;
         display:flex;align-items:center;justify-content:center;
         min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:20px;padding:48px 40px;
          max-width:480px;width:100%;text-align:center;
          box-shadow:0 8px 40px rgba(0,0,0,0.08);border:1px solid #dfe3e7}
    .icon{font-size:56px;margin-bottom:24px}
    h1{font-size:1.5rem;font-weight:800;color:${color};margin-bottom:16px;
       font-family:Manrope,Arial,sans-serif}
    p{color:#3f4949;font-size:0.9375rem;line-height:1.6}
    code{background:#f0f4f8;padding:2px 8px;border-radius:6px;
         font-family:monospace;font-size:0.875rem;color:#00464a}
    .brand{margin-top:32px;padding-top:24px;border-top:1px solid #dfe3e7;
           font-size:0.75rem;color:#6f7979}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${title.split(" ")[0]}</div>
    <h1>${title.split(" ").slice(1).join(" ")}</h1>
    <p>${message}</p>
    <div class="brand">
      Clinical Ledger HIE · Blockchain Health Information Exchange<br/>
      AES-256 Encrypted · Patient-Controlled Access
    </div>
  </div>
</body>
</html>`;
}

// ── Start — DB must be ready before accepting requests ───────────────────────
async function startServer(): Promise<void> {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`[Clinical Ledger HIE] Backend running on port ${PORT}`);
    console.log(`[Clinical Ledger HIE] CORS origin: ${allowedOrigin}`);
  });
}

startServer().catch((err) => {
  console.error("[STARTUP ERROR] Fatal:", err);
  process.exit(1);
});
