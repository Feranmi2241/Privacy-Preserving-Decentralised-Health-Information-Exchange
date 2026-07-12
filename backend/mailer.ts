import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const from = process.env.SENDGRID_FROM_EMAIL as string;
  await sgMail.send({ from, to, subject, html });
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
  await sendEmail(email, "Verify Your Hospital Email — Clinical Ledger HIE",
    emailWrapper("🏥", "Clinical Ledger HIE", "Hospital Registration · Email Verification", `
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
      </div>`));
}

// ── Forgot-password OTP ───────────────────────────────────────────────────────
export async function sendForgotOTP(email: string, code: string): Promise<void> {
  await sendEmail(email, "Password Reset Verification — Clinical Ledger HIE",
    emailWrapper("🔐", "Clinical Ledger HIE", "Account Recovery · Password Reset", `
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
      </div>`));
}

// ── Record stored notification ────────────────────────────────────────────────
export async function sendRecordStoredNotification(
  email: string, patientId: string, txHash: string, ipfsHash: string
): Promise<void> {
  await sendEmail(email, `Record Stored on Blockchain — Patient ${patientId}`,
    emailWrapper("⛓️", "Clinical Ledger HIE", "Immutable Record Confirmation · AES-256 Encrypted", `
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
      </table>`));
}

// ── Patient access authorization request ─────────────────────────────────────
export async function sendPatientAuthorizationRequest(
  patientEmail: string, patientId: string, hospitalName: string,
  token: string, expiresAt: number
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  const approveUrl = `${backendUrl}/access/respond?token=${token}&action=approved`;
  const denyUrl    = `${backendUrl}/access/respond?token=${token}&action=denied`;
  const expiryTime = new Date(expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const safeHospitalName = escapeHtml(hospitalName);
  const safePatientId    = escapeHtml(patientId);

  await sendEmail(patientEmail, `Medical Record Access Request — ${hospitalName}`,
    emailWrapper("🔒", "Clinical Ledger HIE", "Patient Access Authorization · Decentralized Health Information Exchange", `
      <p style="margin-bottom:8px;color:#3f4949;font-size:15px">
        A healthcare provider is requesting access to your medical record.
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;
                  border:1px solid #dfe3e7;margin:20px 0">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${safePatientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Requesting Hospital</td>
            <td style="padding:8px 0;color:#00464a;font-weight:700">${safeHospitalName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Request Expires</td>
            <td style="padding:8px 0;color:#ba1a1a;font-weight:700">${expiryTime} (20 minutes)</td>
          </tr>
        </table>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <a href="${approveUrl}"
           style="flex:1;min-width:140px;display:inline-block;padding:16px 24px;
                  background:linear-gradient(135deg,#00464a,#006064);
                  color:#ffffff;text-decoration:none;border-radius:12px;
                  font-weight:800;font-size:15px;text-align:center">
          ✅ Approve Access
        </a>
        <a href="${denyUrl}"
           style="flex:1;min-width:140px;display:inline-block;padding:16px 24px;
                  background:linear-gradient(135deg,#ba1a1a,#93000a);
                  color:#ffffff;text-decoration:none;border-radius:12px;
                  font-weight:800;font-size:15px;text-align:center">
          ❌ Deny Access
        </a>
      </div>`));
}

// ── Hospital access granted notification ──────────────────────────────────────
export async function sendAccessGrantedNotification(
  hospitalEmail: string, hospitalName: string, patientId: string
): Promise<void> {
  const safePatientId = escapeHtml(patientId);
  await sendEmail(hospitalEmail, `Access Approved — Patient ${patientId}`,
    emailWrapper("✅", "Clinical Ledger HIE", "Access Authorization · Patient Approved", `
      <p style="margin-bottom:16px;color:#3f4949">
        The patient has approved your access request. You may now retrieve the medical record.
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;border:1px solid #dfe3e7">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${safePatientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Status</td>
            <td style="padding:8px 0;color:#00464a;font-weight:800">✅ APPROVED</td>
          </tr>
        </table>
      </div>`));
}

// ── Hospital access denied notification ───────────────────────────────────────
export async function sendAccessDeniedNotification(
  hospitalEmail: string, hospitalName: string, patientId: string,
  reason: "denied" | "expired"
): Promise<void> {
  const isExpired = reason === "expired";
  const safePatientId = escapeHtml(patientId);
  await sendEmail(hospitalEmail, `Access ${isExpired ? "Expired" : "Denied"} — Patient ${patientId}`,
    emailWrapper(
      isExpired ? "⏰" : "❌",
      "Clinical Ledger HIE",
      `Access Authorization · ${isExpired ? "Request Expired" : "Patient Denied"}`,
      `<p style="margin-bottom:16px;color:#3f4949">
        ${isExpired
          ? "The authorization request expired before the patient responded."
          : "The patient has denied your access request."}
      </p>
      <div style="padding:16px;background:#f0f4f8;border-radius:12px;border:1px solid #dfe3e7">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600;width:130px">Patient ID</td>
            <td style="padding:8px 0;color:#171c1f;font-weight:700;font-family:monospace">${safePatientId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6f7979;font-weight:600">Status</td>
            <td style="padding:8px 0;color:#ba1a1a;font-weight:800">
              ${isExpired ? "⏰ EXPIRED" : "❌ DENIED"}
            </td>
          </tr>
        </table>
      </div>`));
}
