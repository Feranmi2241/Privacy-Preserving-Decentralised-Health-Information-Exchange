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

---

## Phase 3 — Client-Side Reads, Consent Hardening, and Contract Redeployment

### What changed

**Contract redeployment.** The Phase 2 contract address is abandoned. A new
contract was deployed to Sepolia as part of this phase. Update `CONTRACT_ADDRESS`
in `backend/.env` and `VITE_CONTRACT_ADDRESS` in `frontend/.env` to the new
address. Any record stored under the old address is no longer reachable through
the application — those IPFS CIDs still exist on Pinata but the on-chain index
is gone.

**RecordAccessed event removed.** The `RecordAccessed` event was removed from
the contract. This is an honest correction: the event was never actually being
emitted even before this phase. `getRecord` and `getRecordVersion` were declared
`nonpayable` (a transaction, not a call), which meant every read cost gas and
produced a transaction receipt — but the `emit RecordAccessed(...)` line inside
those functions was never reached in practice because the backend was calling
them as `eth_call` (view calls), not as `eth_sendTransaction`. The event existed
in the ABI and in the old `shared/MedicalRecordABI.json` but produced zero
on-chain log entries. Removing it is a correction, not a regression.

**getRecord and getRecordVersion are now view functions.** Both functions are
now correctly declared `view`, which means they are free, gas-less calls. This
aligns the contract with how the backend was already calling them.

**grantConsent is now onlyOwner.** Previously `grantConsent` could be called by
any authorized hospital, which allowed a hospital to self-grant consent for any
patient without patient involvement. It is now restricted to the contract owner
(the deployer wallet), which is the backend's signing wallet. The patient
authorization email flow (Task 8) is the only path through which consent is
granted — the backend calls `grantConsent` on the owner wallet only after the
patient explicitly clicks Approve in their email.

**Reads and decryption are now entirely client-side.** The private RSA key
never reaches the server. After patient consent is granted, the frontend calls
`contract.getRecord()` directly via the hospital's MetaMask wallet, fetches the
encrypted payload from IPFS via Pinata, and decrypts it in the browser using the
hospital's private key held in React state. The backend has no role in the read
path beyond the initial consent flow.

### The migration boundary

**All hospital wallet authorizations are lost on redeploy.** The constructor
only auto-authorizes the deployer. Every hospital that completed the wallet-link
flow against the old contract address must redo that step — the backend will call
`authorizeHospital` on the new contract when they reconnect. This is expected and
acceptable for a research-stage project where all hospital accounts are
controlled test accounts.

**shared/MedicalRecordABI.json has been regenerated** from the freshly compiled
artifact. The three ABI-breaking changes are: `RecordAccessed` event removed;
`getRecord` and `getRecordVersion` `stateMutability` changed from `nonpayable`
to `view`; `grantConsent` caller restriction tightened (ABI shape unchanged, but
runtime behaviour changed). Any client that cached the old ABI must reload.
