# Health Blockchain HIE

A privacy-preserving, decentralised Health Information Exchange (HIE) built on Ethereum + IPFS.

## Architecture

- **Smart Contract** (`contracts/MedicalRecord.sol`) — append-only versioned record registry with hospital access control, patient consent model, and on-chain audit events
- **Backend** (`backend/server.ts`) — Express API; hybrid-encrypts records (AES-256-GCM + RSA-OAEP, per-hospital keypairs) before pinning to IPFS via Pinata; implements email-based patient authorization. Decryption never happens server-side — the RSA private key never leaves the browser.
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

# RSA-OAEP public key — used server-side to encrypt records for each hospital.
# The matching private key is held only in the hospital's browser and is never sent to the server.
RSA_PUBLIC_KEY="<output from generateKeys.ts>"

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

The frontend also requires five IPFS gateway URLs for k-set Byzantine consensus (n=5, f=1).
These are already set in `frontend/.env`; replace the Pinata subdomain placeholder with your own:

```
VITE_IPFS_GATEWAY_1=https://<your-pinata-subdomain>.mypinata.cloud/ipfs/
VITE_IPFS_GATEWAY_2=https://ipfs.io/ipfs/
VITE_IPFS_GATEWAY_3=https://dweb.link/ipfs/
VITE_IPFS_GATEWAY_4=https://cloudflare-ipfs.com/ipfs/
VITE_IPFS_GATEWAY_5=https://4everland.io/ipfs/
```

All five must be set. If fewer than 2 are reachable at runtime the frontend throws `INSUFFICIENT_GATEWAYS_RESPONDED`; if fewer than 2 are configured it throws `INSUFFICIENT_GATEWAYS_CONFIGURED`.

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

## Browser Wallet Setup (Required to Run the Dashboard)

Adding a patient record requires a MetaMask (or any EIP-1193 compatible) browser wallet. The hospital's own wallet signs the `storeRecord` transaction on-chain — without it, the "Add Record" flow will fail at the MetaMask step with no funds and no explanation.

### 1. Install MetaMask

Download from [metamask.io](https://metamask.io/download/) and create or import a wallet.

### 2. Add the Sepolia test network

MetaMask includes Sepolia by default. Click the network dropdown at the top of the extension and select **Sepolia**. If it is not listed, enable test networks under **Settings → Advanced → Show test networks**.

### 3. Get free Sepolia test ETH

You need a small amount of Sepolia ETH to pay gas for `storeRecord` transactions. Use any of these faucets — each requires a brief wait or a Google/GitHub login:

- **Alchemy Sepolia Faucet** — [sepoliafaucet.com](https://sepoliafaucet.com) (0.5 ETH/day, requires Alchemy account)
- **Google Cloud Faucet** — [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (0.05 ETH, no account needed)
- **Chainlink Faucet** — [faucets.chain.link](https://faucets.chain.link/sepolia) (0.1 ETH/day)

One faucet request gives enough ETH for hundreds of test transactions.

### 4. Connect the wallet in the dashboard

After logging in, the dashboard will prompt you to link your MetaMask wallet. This signs a one-time message (no gas cost) to associate your wallet address with your hospital account. Every subsequent `storeRecord` call will then prompt MetaMask for a normal transaction signature.

> **Local / Ganache development:** if you are running against a local Ganache network instead of Sepolia, switch MetaMask to the matching custom RPC (`http://127.0.0.1:7545`, chain ID `1337`) and import one of the Ganache-generated private keys — those accounts are pre-funded with test ETH.

---

## How the Patient Authorization Flow Works

This system implements an **email-based, asynchronous access control model** — patients control access to their records via email without needing a separate portal.

### When a hospital tries to view a patient record:

1. Hospital enters the **Patient ID**
2. Backend confirms the record exists on-chain via `getIpfsHash()` — no client-supplied hash needed
3. A **cryptographically secure 256-bit token** is generated (20-minute TTL, one-time use)
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
