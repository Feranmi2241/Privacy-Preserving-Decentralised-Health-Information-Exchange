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

---

## Phase 4 — Backend Module System: ESM Change Reverted, Parallel-Copy Approach Adopted

### What happened

During Phase 4 test tooling work, `backend/package.json` was changed from
`"type": "commonjs"` to `"type": "module"` and `backend/tsconfig.json` was
changed from `"module": "CommonJS"` to `"module": "NodeNext"` (with
`"moduleResolution": "NodeNext"` added). The intent was to allow Hardhat's
ESM-based Mocha runner to import `backend/consensusSimulation.ts` and
`backend/waitFreeRegister.ts` from the root-level test files without a
`SyntaxError: Unexpected token 'export'` error.

This change was validated only by running `npx hardhat test`. The actual backend
server was never started after the change was made.

### Why the ESM change was reverted

Actually running the dev server (`cd backend && npx ts-node --esm server.ts`)
failed immediately with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../backend/blockchain'
```

The cause: all relative imports in `backend/server.ts` (e.g. `"./blockchain"`,
`"./encryption"`, `"./waitFreeRegister"`) lack the explicit `.js` extensions
that NodeNext ESM resolution requires. Additionally, `backend/blockchain.ts`
uses `__dirname`, which does not exist in ESM. Fixing both would have required
changes to every file in the backend — a broad, risky change to a codebase
built and tested across three prior phases under CommonJS.

The ESM change was therefore fully reverted:
- `backend/package.json` — `"type": "commonjs"` removed entirely (Node defaults
  to CJS when the field is absent; runtime behaviour is identical)
- `backend/tsconfig.json` — reverted to `"module": "CommonJS"`,
  `"moduleResolution": "Node"`, `rootDir` removed so TypeScript can follow
  imports into `../shared/` without a TS6059 error while keeping `outDir: ./dist`
  and the `dist/server.js` output path intact
- `backend/package.json` start script — reverted to `ts-node server.ts`

### Why re-exports from shared/ also failed

A re-export approach was attempted in both directions:

1. `backend/` re-exporting from `shared/` — failed at runtime with
   `ERR_REQUIRE_ESM`: `ts-node` (CJS mode) cannot `require()` a file whose
   nearest `package.json` has `"type": "module"`.
2. `shared/` re-exporting from `backend/` — failed with
   `ERR_REQUIRE_CYCLE_MODULE` on Node 24: the ESM loader refuses to
   `require()` a CJS file in a cycle when the call originates from an ESM
   context.

Both directions hit the same fundamental Node 24 constraint: no cross-package
import between the ESM root package and the CJS `backend/` sub-package works
in either direction, regardless of which side holds the implementation.

### The actual fix: parallel standalone copies

The only approach that satisfies all three constraints simultaneously —
(a) tests import from the ESM root package context,
(b) backend server loads its own files under CJS without any cross-package
    import, and
(c) no file in `backend/` is modified beyond what is strictly necessary —
is to keep fully independent copies in both locations:

- `shared/consensusSimulation.ts` — full standalone implementation, ESM root
  package, imported by `test/consensusSimulation.test.ts`
- `shared/waitFreeRegister.ts` — full standalone implementation, ESM root
  package, imported by `test/waitFreeRegister.test.ts`
- `backend/consensusSimulation.ts` — full standalone implementation, CJS,
  imported by `backend/server.ts` (unchanged import path)
- `backend/waitFreeRegister.ts` — full standalone implementation, CJS,
  imported by `backend/server.ts` (unchanged import path)

The two pairs are identical in content. There is no technical coupling between
them — keeping them in sync is a maintenance contract, not an enforced
dependency. Both files are pure logic with zero imports, so drift is unlikely
in practice.

A secondary bug was also found and fixed during this work: `backend/blockchain.ts`
had `path.join(__dirname, "..", "..", "artifacts", ...)` which resolved correctly
from `backend/dist/` (compiled) but resolved two levels too high from `backend/`
(ts-node), landing at the Desktop instead of the project root. Fixed with a
`findAbiPath()` helper that probes one level up first, then two, handling both
contexts correctly.

### Verified state — all three checks run and confirmed

- `cd backend && npx ts-node server.ts` — all modules load cleanly under CJS,
  ABI found, 17 env vars loaded, reaches `initializeDatabase()`, fails only on
  the Aiven PostgreSQL host being unreachable locally (not a code issue)
- `cd backend && npm run build` — `tsc` compiles with zero errors; one
  pre-existing type gap also fixed (`revoked` field missing from `createHospital`
  return value in `dbPostgres.ts`)
- `cd backend && node dist/server.js` — compiled output loads all modules,
  reaches `initializeDatabase()`, same Aiven network error — not a code issue
- `npx hardhat test` — 37 tests passing

The backend's module system is confirmed unchanged from Phases 1–3. The test
tooling change is an isolated addition that does not affect the runtime behaviour
of the Express server in either dev or production mode.

---

## Phase 5 — Sepolia Redeploy: Phase 3 Security Fixes Brought Live

### What happened

Phase 3 made three security-significant changes to the contract (view functions,
`grantConsent` restricted to `onlyOwner`, `RecordAccessed` event removed) and
wrote tests for all of them. However, the actual contract deployed on Sepolia was
never updated at the time — the live app continued pointing at the old Phase 2
address throughout Phases 3 and 4, meaning none of Phase 3's on-chain security
fixes were active in production. This phase redeploys the current contract code
and updates every address reference so the live system finally matches what was
built.

### Addresses

| | Address |
|---|---|
| Old contract (Phase 2 / Phase 3 era) | `0xd2CEAC3c11CA939c0524Db10AF18285F96Abf9Bc` |
| New contract (this redeploy) | `0x0B38aE34a6366590bb81721e79a5429F35CDbbEd` |

Network: Sepolia testnet. Date: 2025-07-10.

### Files updated

- `backend/.env` — `CONTRACT_ADDRESS` updated to new address; `RPC_URL` updated
  from local Ganache (`http://127.0.0.1:7545`) to the Sepolia Alchemy endpoint
  (the backend was pointing at a local node that no longer holds the contract)
- `frontend/.env` — `VITE_CONTRACT_ADDRESS` updated to new address
- Render and Vercel dashboard env vars — require manual update (cannot be
  updated by a local script); flagged as explicit manual steps

### The migration boundary

**All hospital wallet authorizations are reset.** The new contract's constructor
auto-authorizes only the deployer wallet. Every hospital account that previously
completed the wallet-link flow against the old contract address
(`0xd2CEAC3c11CA939c0524Db10AF18285F96Abf9Bc`) is not authorized on the new one,
even though their account still exists in Postgres with a `wallet_address` on
file. Each affected hospital must either redo the wallet-connect step from the
frontend dashboard (which calls `authorizeHospital` as part of that flow), or
the owner wallet must call `authorizeHospital(walletAddress)` directly via the
one-off script at `scripts/authorizeHospitals.ts`.

**All patient records stored under the old contract address are not migrated and
are no longer reachable through the app.** The IPFS payloads still exist on
Pinata and can be fetched directly by CID, but the on-chain index
(`records[patientId]` mapping) lives inside the old contract at
`0xd2CEAC3c11CA939c0524Db10AF18285F96Abf9Bc`. The new contract at
`0x0B38aE34a6366590bb81721e79a5429F35CDbbEd` has an empty records mapping.
Any call to `getRecord`, `getIpfsHash`, or `getRecordCount` for a patient ID
that was stored under the old contract will revert with `"Record not found"`.
This is the same kind of explicit boundary established in Phase 3's migration
note — the old data is not lost from IPFS, but it is unreachable through the
application without pointing back at the old contract address.

This is a known, intentional limitation. All pre-redeploy records are test data
in a research-stage deployment. The decision is documented here so the empty
record state after redeploy is an explained boundary rather than a mystery bug.
