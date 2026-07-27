/**
 * encryption.ts
 *
 * Hybrid Encryption Module for Privacy-Preserving HIE
 * =====================================================
 * Implements the two-layer encryption scheme required by the research:
 *
 *  1. AES-256-GCM  — encrypts the actual patient record (fast, symmetric, tamper-evident)
 *  2. RSA-2048     — encrypts the AES key (asymmetric key exchange)
 *
 * Why hybrid? Encrypting large medical records with RSA alone is slow and
 * size-limited. AES handles the bulk data; RSA secures the key.
 *
 * Prof. Zhan (Information Assurance / Blockchain):
 *   This satisfies the cybersecurity layer of the HIE architecture.
 *   Only the holder of the RSA private key can decrypt the AES key,
 *   and therefore the record — enforcing data ownership at the crypto level.
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  encryptedData: string;            // AES-256-GCM ciphertext (hex)
  iv: string;                       // Initialisation vector (hex)
  encryptedKeys: Record<string, string>; // hospitalEmail → RSA-OAEP-wrapped AES key (base64)
  authTag: string;                  // GCM authentication tag (hex) — tamper-evident seal
}

export interface RSAKeyPair {
  publicKey: string;
  privateKey: string;
}

// ─── RSA Key Generation ───────────────────────────────────────────────────────

/**
 * Generates a 2048-bit RSA key pair.
 * In a real HIE deployment each hospital node would hold its own key pair.
 */
export function generateRSAKeyPair(): RSAKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext medical record using the hybrid scheme:
 *   Step 1 — Generate a random 256-bit AES session key
 *   Step 2 — Encrypt the record with AES-256-GCM (once, regardless of recipient count)
 *   Step 3 — RSA-OAEP-wrap the AES key once per recipient hospital
 *
 * @param plaintext   Raw patient record JSON string
 * @param publicKeys  Map of hospitalEmail → RSA public key PEM for each authorised recipient
 */
export function encryptRecord(plaintext: string, publicKeys: Record<string, string>): EncryptedPayload {
  // Step 1: random AES-256 session key + IV
  const aesKey = crypto.randomBytes(32); // 256 bits
  const iv     = crypto.randomBytes(16); // 128-bit IV for GCM mode

  // Step 2: AES-256-GCM encryption of the record — done exactly once
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encryptedData = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  // Must match the padding/hash used on the decrypt side, or decryption fails
  // Step 3: RSA-OAEP-wrap the same AES key once per recipient hospital
  const encryptedKeys: Record<string, string> = {};
  for (const [email, publicKey] of Object.entries(publicKeys)) {
    encryptedKeys[email] = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey
    ).toString("base64");
  }

  return {
    encryptedData,
    iv: iv.toString("hex"),
    encryptedKeys,
    authTag,
  };
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypts an EncryptedPayload using the holder's RSA private key:
 *   Step 1 — Look up this hospital's wrapped AES key by email
 *   Step 2 — Decrypt the AES key with the RSA private key (RSA-OAEP)
 *   Step 3 — Decrypt the record with the recovered AES key (AES-256-GCM)
 *
 * @param payload        The EncryptedPayload returned by encryptRecord()
 * @param privateKey     RSA private key of the requesting hospital
 * @param hospitalEmail  Email used as the key into payload.encryptedKeys
 */
export function decryptRecord(payload: EncryptedPayload, privateKey: string, hospitalEmail: string): string {
  // Step 1: look up the wrapped AES key for this specific hospital
  const wrappedKey = payload.encryptedKeys[hospitalEmail];
  if (!wrappedKey) {
    throw new Error("NO_KEY_FOR_HOSPITAL");
  }

  // Must match the padding/hash used on the encrypt side, or decryption fails
  // Step 2: recover the AES session key (RSA-OAEP — matches encryptRecord padding)
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(wrappedKey, "base64")
  );

  // Step 3: AES-256-GCM decryption — auth tag verified here; throws if tampered
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    aesKey,
    Buffer.from(payload.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
  return decipher.update(payload.encryptedData, "hex", "utf8") + decipher.final("utf8");
}
