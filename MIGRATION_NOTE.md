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

---

## Phase 2 — Per-Hospital Wallet Identity (on-chain attribution upgrade)

### What changed
Before this phase, every `storeRecord` transaction was sent by the single shared
backend deployer wallet — the same wallet used for admin operations like
`authorizeHospital` and `grantConsent`. As a result, every `RecordAdded` event
emitted before this phase has the deployer's address in the `hospital` field,
regardless of which hospital account actually submitted the record through the
dashboard.

After this phase, each hospital links their own MetaMask wallet to their account
via a SIWE (Sign-In With Ethereum) flow. The `storeRecord` transaction is now
signed and broadcast directly by the hospital's own wallet from the browser.
`RecordAdded` events from this point forward carry that hospital's real wallet
address in the `hospital` field, and `getAllPatientIds()` returns only the
patient IDs submitted by the calling wallet — enforcing per-hospital scoping at
the contract level.

### The migration boundary
Any `RecordAdded` event with a timestamp **before this phase was deployed** will
show the deployer wallet address as the `hospital` field, not the address of the
hospital that actually created the record. This is not a data integrity problem —
the IPFS payload and the patient record contents are unaffected — but it means
on-chain provenance for pre-Phase-2 records does not identify the specific
hospital node that submitted them.

This is a known, intentional limitation. For a research deployment where all
pre-Phase-2 records are test data, this is an acceptable boundary. The decision
is documented here so the address discrepancy in older events is an explained
historical artifact rather than an unexplained inconsistency.

### What this means in practice
- The encounter history timeline in the dashboard resolves the `hospital` wallet
  address to a human-readable hospital name via a reverse lookup against the
  `wallet_address` column. Pre-Phase-2 records will show the deployer wallet
  address raw (no matching name row exists for it), or fall back to the address
  string if the lookup returns null.
- `getAllPatientIds()` scoping is only meaningful from this phase forward. Any
  patient IDs stored under the deployer wallet before this phase are visible only
  to the deployer, not to individual hospital wallets — they are effectively
  unowned by any specific hospital in the new model.
- No re-submission of old records is required for the system to function. The
  boundary only affects on-chain attribution and per-hospital enumeration for
  pre-Phase-2 data.
