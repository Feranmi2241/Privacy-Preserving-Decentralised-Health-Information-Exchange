/**
 * mailer.ts — Email delivery for Clinical Ledger HIE
 *
 * Handles all outbound emails:
 *   1. Hospital signup OTP verification
 *   2. Hospital forgot-password OTP
 *   3. Blockchain record stored notification
 *   4. Patient access authorization request (approve / deny links)
 *   5. Hospital access granted / denied notification
 */

import nodemailer from "nodemailer";

function getTransporter(): nodemailer.Transporter {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    throw new Error(
      "EMAIL_USER and EMAIL_PASS must be set in .env to send emails"
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

// ── Shared email wrapper ──────────────────────────────────────────────────────
function emailWrapper(iconEmoji: string, title: string, subtitle: string, body: string): string {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;
                background:#f6fafe;color:#171c1f;padding:0;
                border-radius:16px;border:1px solid #dfe3e7;overflow:hidden">
      <div style="background:linear-gradient(135deg,#00464a 0%,#006064 100%);
                  padding:28px 32px;display:flex;align-items:center;gap:14px">
        <span style="font-size:32px">${iconEmoji}</span>
        <div>
          <div style="font-family:Manrope,sans-serif;font-weight:800;
                      font-size:1.15rem;color:#ffffff">${title}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);margin-top:2px">${subtitle}</div>
        </div>
      </div>
      <div style="padding:32px">${body}</div>
      <div style="padding:16px 32px;background:#eaeef2;
                  font-size:11px;color:#6f7979;text-align:center">
        Clinical Ledger HIE · Blockchain Health Information Exchange ·
        AES-256 Encrypted · k-Set Byzantine Consensus
      </div>
    </div>`;
}

// ── Signup OTP ────────────────────────────────────────────────────────────────

export async function sendSignupOTP(email: string, code: string): Promise<void> {
  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      email,
    subject: "Verify Your Hospital Email — Clinical Ledger HIE",
    html: emailWrapper("🏥", "Clinical Ledger HIE", "Hospital Registration · Email Verification", `
      <p style="margin-bottom:16px;color:#3f4949">Your hospital email verification code is:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:14px;
                  color:#00464a;margin:24px 0;font-family:Manrope,sans-serif;text-align:center">
        ${code}
      </div>
      <p style="color:#3f4949;font-size:13px;margin-bottom:16px">
        This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
      </p>
      <div style="padding:14px;background:#f0f4f8;border-radius:10px;border-left:3px solid #00464a">
        <p style="font-size:12px;color:#3f4949;margin:0">
          If you did not attempt to register on Clinical Ledger HIE, please ignore this email.
        </p>
      </div>`),
  });
}

// ── Forgot-password OTP ───────────────────────────────────────────────────────

export async function sendForgotOTP(email: string, code: string): Promise<void> {
  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      email,
    subject: "Password Reset Verification — Clinical Ledger HIE",
    html: emailWrapper("🔐", "Clinical Ledger HIE", "Account Recovery · Password Reset", `
      <p style="margin-bottom:16px;color:#3f4949">Your password reset code is:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:14px;
                  color:#0047d6;margin:24px 0;font-family:Manrope,sans-serif;text-align:center">
        ${code}
      </div>
      <p style="color:#3f4949;font-size:13px;margin-bottom:16px">
        This code expires in <strong>10 minutes</strong>.
        If you did not request this, ignore this email.
      </p>
      <div style="padding:14px;background:#f0f4f8;border-radius:10px;border-left:3px solid #0047d6">
        <p style="font-size:12px;color:#3f4949;margin:0">
          For security, never share this code with anyone.
        </p>
      </div>`),
  });
}

// ── Record stored notification ────────────────────────────────────────────────

export async function sendRecordStoredNotification(
  email:     string,
  patientId: string,
  txHash:    string,
  ipfsHash:  string
): Promise<void> {
  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      email,
    subject: `Record Stored on Blockchain — Patient ${patientId}`,
    html: emailWrapper("⛓️", "Clinical Ledger HIE", "Immutable Record Confirmation · AES-256 Encrypted", `
      <p style="margin-bottom:20px;color:#3f4949">
        A medical record has been successfully encrypted, pinned to IPFS,
        and anchored on the Ethereum blockchain.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <tr style="background:#f0f4f8">
          <td style="padding:12px;color:#3f4949;width:110px;font-weight:600">Patient ID</td>
          <td style="padding:12px;color:#171c1f;font-weight:700">${patientId}</td>
        </tr>
        <tr style="border-top:1px solid #dfe3e7">
          <td style="padding:12px;color:#3f4949;font-weight:600">Tx Hash</td>
          <td style="padding:12px;color:#00464a;font-family:monospace;
                     word-break:break-all;font-size:11px">${txHash}</td>
        </tr>
        <tr style="border-top:1px solid #dfe3e7;background:#f0f4f8">
          <td style="padding:12px;color:#3f4949;font-weight:600">IPFS CID</td>
          <td style="padding:12px;color:#0047d6;font-family:monospace;
                     word-break:break-all;font-size:11px">${ipfsHash}</td>
        </tr>
      </table>
      <div style="padding:16px;background:#fff8f0;border-radius:10px;border-left:4px solid #f59e0b">
        <p style="font-size:12px;color:#92400e;margin:0;font-weight:600">
          ⚠️ Keep this Tx Hash and IPFS CID secure.
        </p>
        <p style="font-size:12px;color:#92400e;margin:6px 0 0">
          They are required to retrieve and verify this patient record.
          Do not share them with unauthorised personnel.
        </p>
      </div>`),
  });
}

// ── Patient access authorization request ─────────────────────────────────────
/**
 * Sends the patient an email with Approve / Deny links.
 *
 * This implements the asynchronous, email-driven access control model:
 *   - Fine-grained: per-patient, per-hospital, per-request
 *   - Revocable: patient can deny at any time within the 20-min window
 *   - Auditable: every request is logged with a unique token
 *   - Asynchronous: no persistent UI required on the patient side
 *   - Replay-proof: token is one-time use and expires after 20 minutes
 *
 * Aligned with:
 *   - Prof. Shao (Health IT): patient-controlled data accessibility
 *   - Prof. Zhan (Information Assurance): cryptographic token enforcement
 *   - Prof. Chaudhuri (Distributed Algorithms): asynchronous coordination
 */
export async function sendPatientAuthorizationRequest(
  patientEmail: string,
  patientId:    string,
  hospitalName: string,
  token:        string,
  expiresAt:    number
): Promise<void> {
  const backendUrl  = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  const approveUrl  = `${backendUrl}/access/respond?token=${token}&action=approved`;
  const denyUrl     = `${backendUrl}/access/respond?token=${token}&action=denied`;
  const expiryTime  = new Date(expiresAt).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  });

  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      patientEmail,
    subject: `Medical Record Access Request — ${hospitalName}`,
    html: emailWrapper("🔒", "Clinical Ledger HIE", "Patient Access Authorization · Decentralized Health Information Exchange", `
      <p style="margin-bottom:8px;color:#3f4949;font-size:15px">
        A healthcare provider is requesting access to your medical record.
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;
                  border:1px solid #dfe3e7;margin:20px 0">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${patientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Requesting Hospital</td>
            <td style="padding:8px 0;color:#00464a;font-weight:700">${hospitalName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Request Expires</td>
            <td style="padding:8px 0;color:#ba1a1a;font-weight:700">${expiryTime} (20 minutes)</td>
          </tr>
        </table>
      </div>

      <p style="color:#3f4949;font-size:13px;margin-bottom:24px">
        You are in full control of your medical data. Please choose one of the options below.
        This link is <strong>one-time use</strong> and expires in <strong>20 minutes</strong>.
      </p>

      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <a href="${approveUrl}"
           style="flex:1;min-width:140px;display:inline-block;padding:16px 24px;
                  background:linear-gradient(135deg,#00464a,#006064);
                  color:#ffffff;text-decoration:none;border-radius:12px;
                  font-family:Manrope,sans-serif;font-weight:800;font-size:15px;
                  text-align:center;box-shadow:0 4px 16px rgba(0,70,74,0.25)">
          ✅ Approve Access
        </a>
        <a href="${denyUrl}"
           style="flex:1;min-width:140px;display:inline-block;padding:16px 24px;
                  background:linear-gradient(135deg,#ba1a1a,#93000a);
                  color:#ffffff;text-decoration:none;border-radius:12px;
                  font-family:Manrope,sans-serif;font-weight:800;font-size:15px;
                  text-align:center;box-shadow:0 4px 16px rgba(186,26,26,0.25)">
          ❌ Deny Access
        </a>
      </div>

      <div style="padding:14px;background:#fff8f0;border-radius:10px;
                  border-left:4px solid #f59e0b;margin-bottom:16px">
        <p style="font-size:12px;color:#92400e;margin:0;font-weight:600">
          🔐 Security Notice
        </p>
        <p style="font-size:12px;color:#92400e;margin:6px 0 0">
          This is a one-time, time-bound authorization link. If you did not expect
          this request, click Deny or simply ignore this email — access will be
          automatically denied after 20 minutes.
        </p>
      </div>

      <p style="font-size:11px;color:#6f7979;margin:0">
        This request is cryptographically secured and logged on the Ethereum blockchain
        for full auditability. Your decision is final and cannot be altered by the requesting hospital.
      </p>`),
  });
}

// ── Hospital access granted notification ──────────────────────────────────────

export async function sendAccessGrantedNotification(
  hospitalEmail: string,
  hospitalName:  string,
  patientId:     string
): Promise<void> {
  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      hospitalEmail,
    subject: `Access Approved — Patient ${patientId}`,
    html: emailWrapper("✅", "Clinical Ledger HIE", "Access Authorization · Patient Approved", `
      <p style="margin-bottom:16px;color:#3f4949">
        The patient has approved your access request. You may now retrieve the medical record.
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;border:1px solid #dfe3e7;margin-bottom:20px">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${patientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Authorized To</td>
            <td style="padding:8px 0;color:#00464a;font-weight:700">${hospitalName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Status</td>
            <td style="padding:8px 0;color:#00464a;font-weight:800">✅ APPROVED</td>
          </tr>
        </table>
      </div>
      <p style="font-size:12px;color:#6f7979">
        Return to the Clinical Ledger HIE dashboard. The record will now be displayed automatically.
      </p>`),
  });
}

// ── Hospital access denied notification ───────────────────────────────────────

export async function sendAccessDeniedNotification(
  hospitalEmail: string,
  hospitalName:  string,
  patientId:     string,
  reason:        "denied" | "expired"
): Promise<void> {
  const isExpired = reason === "expired";
  await getTransporter().sendMail({
    from:    `"Clinical Ledger HIE" <${process.env.EMAIL_USER}>`,
    to:      hospitalEmail,
    subject: `Access ${isExpired ? "Expired" : "Denied"} — Patient ${patientId}`,
    html: emailWrapper(
      isExpired ? "⏰" : "❌",
      "Clinical Ledger HIE",
      `Access Authorization · ${isExpired ? "Request Expired" : "Patient Denied"}`,
      `
      <p style="margin-bottom:16px;color:#3f4949">
        ${isExpired
          ? "The authorization request expired before the patient responded."
          : "The patient has denied your access request."}
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;border:1px solid #dfe3e7;margin-bottom:20px">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${patientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Hospital</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700">${hospitalName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Status</td>
            <td style="padding:8px 0;color:#ba1a1a;font-weight:800">
              ${isExpired ? "⏰ EXPIRED" : "❌ DENIED"}
            </td>
          </tr>
        </table>
      </div>
      <p style="font-size:12px;color:#6f7979">
        You may submit a new access request from the Clinical Ledger HIE dashboard.
        Patient data sovereignty is enforced — access cannot be granted without explicit patient approval.
      </p>`),
  });
}
