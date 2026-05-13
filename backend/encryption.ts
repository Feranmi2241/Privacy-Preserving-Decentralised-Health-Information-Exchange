/**
 * encryption.ts
 *
 * Hybrid Encryption Module for Privacy-Preserving HIE
 * =====================================================
 * Implements the two-layer encryption scheme required by the research:
 *
 *  1. AES-256-CBC  — encrypts the actual patient record (fast, symmetric)
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
  encryptedData: string;   // AES-256-CBC ciphertext (hex)
  iv: string;              // Initialisation vector (hex)
  encryptedKey: string;    // RSA-encrypted AES key (base64)
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
 *   Step 2 — Encrypt the record with AES-256-CBC
 *   Step 3 — Encrypt the AES key with the recipient's RSA public key
 *
 * @param plaintext   Raw patient record JSON string
 * @param publicKey   RSA public key of the authorised recipient (hospital/patient)
 */
export function encryptRecord(plaintext: string, publicKey: string): EncryptedPayload {
  // Step 1: random AES-256 session key + IV
  const aesKey = crypto.randomBytes(32); // 256 bits
  const iv = crypto.randomBytes(16);     // 128-bit IV for CBC mode

  // Step 2: AES-256-CBC encryption of the record
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  const encryptedData =
    cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");

  // Step 3: RSA encryption of the AES key
  const encryptedKey = crypto
    .publicEncrypt(publicKey, aesKey)
    .toString("base64");

  return {
    encryptedData,
    iv: iv.toString("hex"),
    encryptedKey,
  };
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypts an EncryptedPayload using the holder's RSA private key:
 *   Step 1 — Decrypt the AES key with the RSA private key
 *   Step 2 — Decrypt the record with the recovered AES key
 *
 * @param payload     The EncryptedPayload returned by encryptRecord()
 * @param privateKey  RSA private key of the authorised recipient
 */
export function decryptRecord(payload: EncryptedPayload, privateKey: string): string {
  // Step 1: recover the AES session key
  const aesKey = crypto.privateDecrypt(
    privateKey,
    Buffer.from(payload.encryptedKey, "base64")
  );

  // Step 2: AES-256-CBC decryption
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    aesKey,
    Buffer.from(payload.iv, "hex")
  );
  return decipher.update(payload.encryptedData, "hex", "utf8") + decipher.final("utf8");
}
