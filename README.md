# Health Blockchain HIE

A privacy-preserving, decentralised Health Information Exchange (HIE) built on Ethereum + IPFS.

## Architecture

- **Smart Contract** (`contracts/MedicalRecord.sol`) — append-only versioned record registry with hospital access control, patient consent model, and on-chain audit events
- **Backend** (`backend/server.ts`) — Express API; hybrid-encrypts records (AES-256-CBC + RSA-2048) before pinning to IPFS via Pinata; applies k-set Byzantine consensus on retrieval; implements email-based patient authorization
- **Wait-Free Register** (`backend/waitFreeRegister.ts`) — atomic MRMW shared register simulation (Prof. Chaudhuri, Iowa State) for distributed consent state management
- **Frontend** (`frontend/`) — React + Vite dashboard for hospitals to add and view patient records with asynchronous patient authorization flow

---

## Setup

### 1. Compile the smart contract (generates the ABI)

```shell
npx hardhat compile
```

This creates `artifacts/contracts/MedicalRecord.sol/MedicalRecord.json` which the backend reads at runtime.

### 2. Generate RSA Keys (one-time)

```shell
cd backend
npx ts-node generateKeys.ts
```

Copy the printed `RSA_PUBLIC_KEY` and `RSA_PRIVATE_KEY` lines into `backend/.env`.

### 3. Configure environment variables

Create `backend/.env` with **all** of the following:

```
# Blockchain
RPC_URL=http://127.0.0.1:7545
CONTRACT_ADDRESS=<deployed contract address>
PRIVATE_KEY=<your wallet private key>

# IPFS / Pinata
PINATA_JWT=<your Pinata JWT>
PINATA_GATEWAY=<your Pinata gateway domain>

# RSA-2048 encryption keys (generated in step 2)
RSA_PUBLIC_KEY="<output from generateKeys.ts>"
RSA_PRIVATE_KEY="<output from generateKeys.ts>"

# Auth — generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=<minimum 64 random characters>

# Email (Gmail + App Password)
# Generate an App Password at: https://myaccount.google.com/apppasswords
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_gmail_app_password

# CRITICAL: Backend public URL — used in patient authorization email links
# For local development: http://localhost:5000
# For production: set to your deployed backend URL (see Production section below)
BACKEND_URL=http://localhost:5000

# CORS — set to your deployed frontend URL in production
ALLOWED_ORIGIN=http://localhost:5173

# Server port (optional, defaults to 5000)
PORT=5000
```

The `frontend/.env` is pre-configured with `VITE_API_URL=http://localhost:5000`.
For production, set `VITE_API_URL` to your deployed backend URL.

### 4. Deploy the smart contract

```shell
npx hardhat run scripts/deploy.ts --network ganache
```

Paste the printed contract address into `backend/.env` as `CONTRACT_ADDRESS`.

### 5. Start the backend (development)

```shell
cd backend && npm start
```

### 6. Start the frontend

```shell
cd frontend && npm run dev
```

---

## How the Patient Authorization Flow Works

This system implements an **email-based, asynchronous access control model** — patients control access to their records via email without needing a separate portal.

### When a hospital tries to view a patient record:

1. Hospital enters the **Patient ID**, **Tx Hash**, and **IPFS CID**
2. System verifies the Tx Hash and IPFS CID against the blockchain
3. If valid — a **cryptographically secure 256-bit token** is generated (20-minute TTL, one-time use)
4. An authorization email is sent to the **patient's registered email address** with Approve and Deny buttons
5. Hospital is shown a **waiting page** with a live countdown timer
6. The frontend **polls every 5 seconds** for the patient's response
7. **If patient approves** → blockchain consent is updated, wait-free register is written, hospital automatically sees the full record
8. **If patient denies or 20 minutes expire** → hospital sees a denial message with a Resend option

### Patient email contains:
- Clear notification of who is requesting access
- One-click **Approve** button
- One-click **Deny** button
- Token expires in 20 minutes and is one-time use (replay-attack proof)

---

## Production Deployment

### ⚠️ Critical: Set BACKEND_URL before deploying

The patient authorization emails contain approve/deny links that point to your backend.
If `BACKEND_URL` is left as `http://localhost:5000`, patients will get a
"site can't be reached" error when they click the links.

**Before deploying, update these two values:**

| Variable | Development | Production |
|---|---|---|
| `BACKEND_URL` | `http://localhost:5000` | `https://your-app.railway.app` |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | `https://your-frontend.vercel.app` |

And in `frontend/.env`:

| Variable | Development | Production |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5000` | `https://your-app.railway.app` |

### Build and run

Always run these commands from inside the `backend/` directory:

```shell
cd backend
npm run build        # compiles TypeScript → dist/
npm run start:prod   # runs node dist/server.js
```

### Database persistence

This system uses **PostgreSQL** for persistent storage of:

- Hospital accounts — registered hospital nodes
- Patient email mappings — patient ID → email (used for authorization requests)

Both are stored in a PostgreSQL database configured via the `DATABASE_URL`
environment variable.

**Local development:** Install PostgreSQL, create a database called
`clinical_ledger`, and set:


Both files are created automatically on first run and excluded from git.

**On ephemeral platforms (Railway, Render, Heroku):** mount a persistent
volume at `backend/data/` — otherwise all registered hospitals and patient
email mappings are lost on every deploy.

### ABI file

The backend reads the compiled contract ABI from:

```
<project-root>/artifacts/contracts/MedicalRecord.sol/MedicalRecord.json
```

Run `npx hardhat compile` whenever the contract changes.

---

## Running Tests

```shell
npx hardhat test
```
