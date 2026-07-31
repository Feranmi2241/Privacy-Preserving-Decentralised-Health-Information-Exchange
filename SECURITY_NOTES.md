# Security Notes

---

## Dependency Audit Results

`npm audit fix` was run in both `backend/` and `frontend/` as part of Phase 3 (Task 9).

### Backend — resolved

All 7 findings (2 high, 4 moderate, 1 low) were resolved by `npm audit fix`:

| Package | Severity | Advisory |
|---|---|---|
| `ws` (via `ethers`) | High | GHSA-96hv-2xvq-fx4p — memory exhaustion DoS |
| `path-to-regexp` | High | GHSA-j3q9-mxjg-w52f — ReDoS via sequential optional groups |
| `express-rate-limit` → `ip-address` | Moderate | GHSA-v2v4-37r5-5v8g — XSS in Address6 HTML methods |
| `ethers` → `ws` | Moderate | GHSA-58qx-3vcg-4xpx — uninitialized memory disclosure |
| `qs` | Moderate | GHSA-q8mj-m7cp-5q26 — DoS via null entries in comma arrays |
| `body-parser` | Low | GHSA-v422-hmwv-36x6 — invalid limit silently disables size enforcement |

`npm audit` now reports **0 vulnerabilities** in `backend/`.

### Frontend — partially resolved

`npm audit fix` resolved 1 of 6 findings. The remaining 5 are all **high** severity and
all trace to the same root cause: `brace-expansion <=5.0.7` inside `eslint`'s own
dependency tree (`eslint` → `@eslint/config-array` / `@eslint/eslintrc` → `minimatch`
→ `brace-expansion`).

**These are intentionally left unfixed.** The proposed fix (`npm audit fix --force`)
would upgrade `eslint` to v10.8.0, a major version bump of a dev-only linting tool.
`eslint` is not included in the production bundle — it runs only during development and
CI. Forcing a major version upgrade this late in the project risks breaking the existing
lint configuration and TypeScript rules without any security benefit to the deployed
application. The vulnerabilities are DoS patterns in a glob-matching library that is
only ever invoked by the developer's own machine when running `eslint`, not by any
user-facing code path.

| Package | Severity | Advisory | Reason left unfixed |
|---|---|---|---|
| `brace-expansion` (×5 paths via `eslint`) | High | GHSA-mh99-v99m-4gvg, GHSA-3jxr-9vmj-r5cp, GHSA-f886-m6hf-6m8v | Fix requires `eslint` major version bump; dev-only, not in production bundle |

---

## Security Model — Phase 3

After Phase 3, the RSA private key and Ethereum wallet signatures used by hospital
accounts **never leave the hospital's browser**. This guarantee is enforced by
architecture, not by policy alone: no server-side route accepts, stores, or processes
either secret. The `/get-record`, `/record-history`, and amendment-backfill paths that
previously received the RSA private key as a request body parameter have been removed
entirely (Task 6). The `storeRecord` transaction is signed directly by the hospital's
MetaMask wallet in the browser and broadcast to the network without the backend ever
seeing the private key (Phase 2). All record decryption is performed in the browser
using the Web Crypto API (`SubtleCrypto`, Task 2), with the plaintext existing only in
JavaScript memory for the duration of the render.

The specific defenses protecting this boundary from cross-site scripting (XSS) are:

- **Content-Security-Policy** (`frontend/index.html`, Task 9): `script-src 'self'`
  blocks inline script injection and `eval`; `connect-src` is restricted to exactly the
  two origins the page's own `fetch()` calls (backend API and Pinata IPFS gateway),
  preventing exfiltration to attacker-controlled endpoints even if script execution were
  somehow achieved.
- **Key clearing on sign-out** (`App.tsx` `handleSignOut`): `rsaKey` is held in plain
  React state and explicitly zeroed (`setRsaKey('')`) on every logout path, ensuring the
  key does not persist in memory across sessions.
- **No key persistence** (`App.tsx`): `rsaKey` is never written to `localStorage` or
  `sessionStorage`, so it cannot be read by a script running in a later session or by
  any other origin.

### Intentional consequence: key must be re-supplied on every new session

`AuthPage.tsx`'s normal `/auth/login` flow always passes an empty string for the RSA
key to `onAuth(...)`. This is by design: the private key is shown exactly once, at
account verification time (`/auth/verify-otp`), and is never stored server-side. It
cannot be recalled or re-issued by the backend. As a result, every hospital must
re-paste their private key via the "paste your key" prompt on every new browser session,
including immediately after first receiving it during signup.

This is a deliberate security tradeoff. Automatically restoring a decrypted secret
across sessions would require either storing it in `localStorage` (persistent, readable
by any script on the same origin) or re-fetching it from the server (which would require
the server to store it, defeating the entire architecture). Neither option is acceptable
given that the private key is the sole credential protecting every patient record this
hospital has ever been granted access to. The cost — hospitals must retain their own
copy of the key and paste it at the start of each session — is the correct tradeoff for
a system where the alternative is a server-side copy of a key that unlocks sensitive
medical records. Hospital operators should be instructed to store their key in a password
manager or equivalent secure credential store, and to treat loss of the key as permanent
loss of access to all previously encrypted records (re-encryption by the system
administrator would be required to restore access).
