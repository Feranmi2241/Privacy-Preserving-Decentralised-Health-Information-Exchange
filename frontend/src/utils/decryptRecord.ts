/**
 * decryptRecord.ts
 *
 * Browser-side twin of backend/encryption.ts's decryptRecord().
 * Built on the Web Crypto API (SubtleCrypto) instead of Node's crypto module.
 *
 * Encoding note — matches backend/encryption.ts exactly:
 *   encryptedData, iv, authTag  → hex-encoded strings
 *   encryptedKeys values        → base64-encoded strings
 *
 * AES-GCM concatenation note:
 *   Node's createCipheriv outputs ciphertext and authTag as separate values.
 *   SubtleCrypto.decrypt() for AES-GCM expects them concatenated:
 *   [ ciphertext bytes | authTag bytes ] as one buffer.
 */

export interface EncryptedPayload {
  encryptedData: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  authTag: string;
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  return base64ToArrayBuffer(b64);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Decrypts an EncryptedPayload in the browser using the hospital's RSA private key.
 * Mirrors backend decryptRecord(payload, privateKey, hospitalEmail) exactly.
 *
 * @param payload        EncryptedPayload fetched from IPFS
 * @param privateKeyPem  Hospital's RSA-2048 private key (PKCS8 PEM)
 * @param hospitalEmail  Used to look up this hospital's wrapped AES key
 */
export async function decryptRecordBrowser(
  payload: EncryptedPayload,
  privateKeyPem: string,
  hospitalEmail: string
): Promise<string> {
  // Step 1: look up the wrapped AES key for this hospital
  const wrappedKeyB64 = payload.encryptedKeys[hospitalEmail];
  if (!wrappedKeyB64) {
    throw new Error("NO_KEY_FOR_HOSPITAL");
  }

  // Step 2: import the RSA private key
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );

  // Step 3: RSA-OAEP-decrypt the wrapped AES key
  const aesKeyRaw = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToArrayBuffer(wrappedKeyB64)
  );

  // Step 4: import the recovered AES key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyRaw,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  // Step 5: concatenate ciphertext + authTag (SubtleCrypto AES-GCM requirement)
  const ciphertext = hexToArrayBuffer(payload.encryptedData);
  const authTag    = hexToArrayBuffer(payload.authTag);
  const combined   = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(new Uint8Array(authTag), ciphertext.byteLength);

  // Step 6: AES-256-GCM decrypt — throws if auth tag doesn't match (tamper detection)
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToArrayBuffer(payload.iv) },
    aesKey,
    combined.buffer
  );

  return new TextDecoder().decode(plaintextBuffer);
}
