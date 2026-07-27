# Migration Notes

This file documents known migration boundaries between development phases.
Later phases will append additional sections here.

---

## Phase 1 — Per-Hospital RSA Keypair Encryption (encryption core upgrade)

### What changed
Before this phase, every patient record in the system was encrypted using a
single shared RSA public key loaded from the server's environment variables
(`RSA_PUBLIC_KEY` / `RSA_PRIVATE_KEY`). Any record could be decrypted by
whoever held that one global private key.

After this phase, each hospital account gets its own RSA-2048 keypair generated
at the moment their email is verified during signup. The hospital's public key is
stored in the database; the private key is returned once in the signup response
and never stored server-side. Records are now encrypted with a per-hospital
`encryptedKeys` map — one RSA-OAEP-wrapped AES key entry per consented hospital
— so only the intended hospital(s) can decrypt any given record.

### The migration boundary
Any patient record created **before this phase was deployed** was encrypted under
the old single shared key. Those records have an `encryptedKey` field (singular,
string) in their IPFS payload, not the new `encryptedKeys` map. They will **not**
be automatically re-encrypted under the new per-hospital scheme.

This is a known, intentional limitation — not a bug or an oversight. For a
research/development-stage project where all test accounts are controlled, this
is an acceptable boundary. The decision is documented here so it is an explicit,
explained choice rather than a mysterious inconsistency discovered later.

### What this means in practice
- Old records cannot be decrypted by the new `decryptRecord()` call, which
  looks up `payload.encryptedKeys[hospitalEmail]` — that key won't exist on
  old payloads, and `decryptRecord` will throw `NO_KEY_FOR_HOSPITAL`.
- The server handles this gracefully with a 403 response and a clear message
  rather than an unhandled crash.
- To make old records readable again, they would need to be re-fetched from
  IPFS, decrypted with the old global key, re-encrypted under the new scheme,
  and re-pinned. This re-encryption migration is out of scope for Phase 1.

### Hospital accounts created before this phase
Any hospital account that completed signup before this phase was deployed will
not have an `rsa_public_key` row in the database. When `/add-record` builds the
`encryptedKeys` map, it skips any hospital without a key on file and logs a
named warning. Affected hospitals need to go through a one-time keypair
regeneration step (not yet built — out of scope for Phase 1, since all test
accounts can simply be re-registered in a development environment).
