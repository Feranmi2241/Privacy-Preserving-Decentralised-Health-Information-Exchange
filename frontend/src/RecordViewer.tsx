import { useState, useEffect, useRef } from 'react';
import PatientForm from './PatientForm';

interface FullRecord {
  patientId: string; fullName: string; dateOfBirth: string; patientEmail: string;
  phone: string; address: string;
  allergies: string; existingConditions: string; bloodGroup: string;
  symptoms: string; diagnosis: string;
  medication: string; dosage: string; instructions: string;
  doctorName: string; department: string;
  profilePhoto: string;
  hospital: string; timestamp: string; version: string; ipfsHash: string;
}

interface EncounterEntry {
  label: string; version: string; timestamp: string; ipfsHash: string;
  doctorName: string; department: string;
  symptoms: string; diagnosis: string;
  medication: string; dosage: string; instructions: string;
  allergies: string; existingConditions: string;
}

type Step = 'search' | 'waiting' | 'result';
type AccessStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'not_found';

const ACCESS_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

function formatDate(ts: string) {
  const ms = Number(ts) * 1000;
  return isNaN(ms) ? ts : new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

// Version label follows HL7 FHIR "Encounter" terminology — v1 is the initial
// patient record; every subsequent version is a clinical encounter, matching
// the Encounter resource model used in the MedicalRecord.sol header comment.
function formatVersion(version: string | number): string {
  const v = Number(version);
  if (v === 1) return 'Initial Record';
  return `Encounter ${v - 1}`;
}

function RecordSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <span>{icon}</span>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="record-field">
      <span className="field-label">{label}</span>
      <span className={`field-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export default function RecordViewer({ token }: { token: string }) {
  const [step, setStep]           = useState<Step>('search');
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading]     = useState(false);
  const [record, setRecord]       = useState<FullRecord | null>(null);
  const [error, setError]         = useState('');
  const [showEncounter, setShowEncounter]   = useState(false);
  const [history, setHistory]               = useState<EncounterEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Waiting page state
  const [accessStatus, setAccessStatus]     = useState<AccessStatus>('pending');
  const [timeRemaining, setTimeRemaining]   = useState(ACCESS_TIMEOUT_MS);
  const [maskedEmail, setMaskedEmail]       = useState('');
  const [resending, setResending]           = useState(false);
  const [resendInfo, setResendInfo]         = useState('');

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current)     { clearInterval(pollRef.current);     pollRef.current = null; }
    if (countdownRef.current){ clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const reset = () => {
    stopPolling();
    setStep('search'); setPatientId('');
    setRecord(null); setError('');
    setAccessStatus('pending'); setTimeRemaining(ACCESS_TIMEOUT_MS);
    setMaskedEmail(''); setResendInfo('');
    setShowEncounter(false); setHistory([]);
  };

  // Clean up on unmount
  useEffect(() => () => stopPolling(), []);

  // handleSearch: sends access request directly — no separate verify step
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId.trim()) { setError('Enter a Patient ID.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/access/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: patientId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMaskedEmail(data.patientEmail || '');
      setTimeRemaining(ACCESS_TIMEOUT_MS);
      setStep('waiting');
      startPolling(patientId.trim());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch the full record after approval — patientId only, backend resolves hash
  const fetchRecord = async (pid: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/get-record/${encodeURIComponent(pid)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retrieve record');
      setRecord(data);
      setStep('result');
      fetchHistory(pid);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch full encounter history after access is approved
  const fetchHistory = async (pid: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/record-history/${encodeURIComponent(pid)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok) setHistory(data.encounters || []);
    } catch { /* non-fatal */ } finally {
      setHistoryLoading(false);
    }
  };

  // Poll /access/status every 5 seconds
  const startPolling = (pid: string) => {
    stopPolling();

    // Countdown timer
    const startTime = Date.now();
    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, ACCESS_TIMEOUT_MS - elapsed);
      setTimeRemaining(remaining);
      if (remaining === 0) stopPolling();
    }, 1000);

    // Status poll
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/access/status?patientId=${encodeURIComponent(pid)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        const status: AccessStatus = data.status;
        setAccessStatus(status);

        if (status === 'approved') {
          stopPolling();
          await fetchRecord(pid);
        } else if (status === 'denied' || status === 'expired') {
          stopPolling();
        }
      } catch { /* non-fatal — keep polling */ }
    }, 5000);
  };

  // Resend authorization request
  const handleResend = async () => {
    setResending(true); setResendInfo(''); setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/access/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: patientId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resend failed');
      setResendInfo('A new authorization request has been sent to the patient.');
      setAccessStatus('pending');
      setTimeRemaining(ACCESS_TIMEOUT_MS);
      startPolling(patientId.trim());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  const isTimedOut = timeRemaining === 0 || accessStatus === 'expired';
  const isDenied   = accessStatus === 'denied';

  return (
    <div className="fade-in">

      {/* ── Step 1: Search ── */}
      {step === 'search' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title"><span>🔍</span> Retrieve Patient Record</div>
          <p className="card-subtitle">Enter a Patient ID to send an authorization request to the patient</p>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <input
                value={patientId}
                onChange={e => { setPatientId(e.target.value); setError(''); }}
                placeholder="Enter Patient ID..."
                autoComplete="off"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: 'auto', padding: '12px 22px', whiteSpace: 'nowrap' }}>
              {loading ? <><span className="spinner" /> Sending...</> : '📨 Request Access'}
            </button>
          </form>
          {error && <div className="alert alert-error" style={{ marginTop: 14 }}><span className="alert-icon">⚠️</span><div className="alert-body">{error}</div></div>}
        </div>
      )}

      {/* ── Step 2: Waiting for patient authorization ── */}
      {step === 'waiting' && (
        <div className="card slide-in" style={{ marginBottom: 20, textAlign: 'center' }}>

          {/* Status icon */}
          <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>
            {isDenied ? '❌' : isTimedOut ? '⏰' : '⏳'}
          </div>

          {/* Title */}
          <div className="card-title" style={{ justifyContent: 'center', marginBottom: 8 }}>
            {isDenied
              ? 'Access Denied by Patient'
              : isTimedOut
              ? 'Authorization Request Expired'
              : 'Waiting for Patient Authorization'}
          </div>

          {/* Message */}
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: 24, lineHeight: 1.6 }}>
            {isDenied
              ? 'The patient has denied your access request. Patient data sovereignty is enforced — access cannot be granted without explicit patient approval.'
              : isTimedOut
              ? 'The authorization request expired. The patient did not respond within the allowed 20-minute time window.'
              : <>
                  An authorization request has been sent to the patient's registered email address
                  {maskedEmail && <> (<strong style={{ color: 'var(--text)' }}>{maskedEmail}</strong>)</>}.
                  <br /><br />
                  Please wait for the patient to approve or deny access.
                  This page will automatically update when the patient responds.
                </>
            }
          </p>

          {/* Countdown timer — only shown while pending */}
          {!isDenied && !isTimedOut && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '12px 24px',
              background: timeRemaining < 5 * 60 * 1000
                ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.08)',
              border: `1px solid ${timeRemaining < 5 * 60 * 1000
                ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.2)'}`,
              borderRadius: 12, marginBottom: 24,
            }}>
              <span style={{ fontSize: '1.1rem' }}>⏱</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Time Remaining
                </p>
                <p style={{
                  fontSize: '1.5rem', fontWeight: 800,
                  fontFamily: 'Courier New, monospace',
                  color: timeRemaining < 5 * 60 * 1000 ? 'var(--error)' : 'var(--accent)',
                }}>
                  {formatCountdown(timeRemaining)}
                </p>
              </div>
            </div>
          )}

          {/* Polling indicator */}
          {!isDenied && !isTimedOut && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 16px', background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, marginBottom: 24,
              fontSize: '0.8rem', color: '#6ee7b7',
            }}>
              <span className="spinner" style={{ borderColor: 'rgba(110,231,183,0.3)', borderTopColor: '#6ee7b7' }} />
              Checking for patient response every 5 seconds...
            </div>
          )}

          {/* Research context chip */}
          <div style={{
            padding: '10px 14px', background: 'rgba(99,102,241,0.06)',
            border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10,
            fontSize: '0.75rem', color: '#a5b4fc', marginBottom: 24, textAlign: 'left',
          }}>
            <strong>Asynchronous Access Control Model:</strong> This mechanism implements
            patient-controlled, email-driven authorization — a lightweight, UI-independent
            access control model for decentralized healthcare systems. Consent state is
            managed via a wait-free shared register (Chaudhuri, Iowa State) and enforced
            on the Ethereum blockchain.
          </div>

          {resendInfo && (
            <div className="alert alert-success" style={{ marginBottom: 16, textAlign: 'left' }}>
              <span className="alert-icon">✅</span>
              <div className="alert-body">{resendInfo}</div>
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, textAlign: 'left' }}>
              <span className="alert-icon">⚠️</span>
              <div className="alert-body">{error}</div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={reset} style={{ width: 'auto', padding: '12px 20px' }}>
              ← New Search
            </button>
            {(isTimedOut || isDenied) && (
              <button
                className="btn btn-primary"
                onClick={handleResend}
                disabled={resending}
                style={{ width: 'auto', padding: '12px 24px' }}
              >
                {resending
                  ? <><span className="spinner" /> Sending...</>
                  : '🔄 Resend Authorization Request'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Add Encounter overlay ── */}
      {showEncounter && record && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 1000, overflowY: 'auto', padding: '32px 16px',
        }}>
          <div style={{ width: '100%', maxWidth: 720, position: 'relative' }}>
            <button
              onClick={() => setShowEncounter(false)}
              style={{
                position: 'absolute', top: -12, right: -12, zIndex: 10,
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5', fontSize: '1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >✕</button>
            <PatientForm
              token={token}
              encounterContext={{
                patientId: record.patientId,
                previousIpfsHash: record.ipfsHash,
              }}
              onRecordAdded={() => {
                setShowEncounter(false);
                fetchRecord(record.patientId);
              }}
            />
          </div>
        </div>
      )}

      {/* ── Step 3: Full Record ── */}
      {step === 'result' && record && (
        <div className="record-card slide-in">
          <div className="record-header">
            <div className="record-avatar" style={{ overflow: record.profilePhoto ? 'hidden' : undefined, padding: record.profilePhoto ? 0 : undefined }}>
              {record.profilePhoto
                ? <img src={record.profilePhoto} alt={record.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : '👤'}
            </div>
            <div className="record-header-info">
              <h3>{record.fullName || `Patient ${record.patientId}`}</h3>
              <span>Medical Record — Verified on Blockchain · Patient Authorized</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <span className="badge badge-success">✓ On-Chain</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '6px 14px', width: 'auto' }}
                  onClick={() => setShowEncounter(true)}
                >
                  🔄 Add Encounter
                </button>
                <button className="auth-link" style={{ fontSize: '0.75rem' }} onClick={reset}>← New Search</button>
              </div>
            </div>
          </div>

          <div className="record-body">
            <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.07)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.15)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>🕐 Record stored on:</span>
              <span style={{ fontSize: '0.85rem', color: '#93c5fd', fontWeight: 600 }}>{formatDate(record.timestamp)}</span>
              <span className="badge badge-info" style={{ marginLeft: 'auto' }}>{formatVersion(record.version)}</span>
            </div>

            <RecordSection icon="🪪" title="Patient Identification">
              {record.profilePhoto && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <img src={record.profilePhoto} alt={record.fullName} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)', boxShadow: '0 4px 20px rgba(59,130,246,0.3)' }} />
                </div>
              )}
              <Field label="Patient ID"    value={record.patientId} />
              <Field label="Full Name"     value={record.fullName} />
              <Field label="Date of Birth" value={record.dateOfBirth} />
            </RecordSection>

            <RecordSection icon="📞" title="Contact Information">
              <Field label="Phone Contact" value={record.phone} />
              <Field label="Address"       value={record.address} />
            </RecordSection>

            <RecordSection icon="🩸" title="Medical Summary">
              <Field label="Blood Group"          value={record.bloodGroup} />
              <Field label="Allergies"            value={record.allergies || '—'} />
              <Field label="Existing Conditions"  value={record.existingConditions || '—'} />
            </RecordSection>

            <RecordSection icon="🏥" title="Visit Information">
              <Field label="Symptoms / Complaint" value={record.symptoms} />
              <div className="record-field">
                <span className="field-label">🩺 Diagnosis / Clinical Notes</span>
                <span className="field-value diagnosis">{record.diagnosis}</span>
              </div>
            </RecordSection>

            <RecordSection icon="💊" title="Treatment / Prescription">
              <Field label="Medication Given" value={record.medication} />
              <Field label="Dosage"           value={record.dosage} />
              <Field label="Instructions"     value={record.instructions} />
            </RecordSection>

            <RecordSection icon="👨‍⚕️" title="Doctor Information">
              <Field label="Doctor's Name" value={record.doctorName} />
              <Field label="Department"    value={record.department} />
            </RecordSection>

            <RecordSection icon="⛓️" title="Blockchain Provenance">
              <Field label="Hospital Address (Wallet)" value={record.hospital} mono />
              <Field label="IPFS CID"                  value={record.ipfsHash}  mono />
            </RecordSection>

            {/* ── Encounter History Timeline ── */}
            <div style={{ marginTop: 32 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 16, paddingBottom: 8,
                borderBottom: '1px solid var(--border)',
              }}>
                <span>📋</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                  Encounter History
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {history.length > 0 ? `${history.length} record${history.length > 1 ? 's' : ''}` : ''}
                </span>
              </div>

              {historyLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1, 2].map(i => (
                    <div key={i} style={{
                      height: 80, borderRadius: 12,
                      background: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%)',
                      backgroundSize: '400px 100%',
                      animation: 'shimmer 1.4s infinite',
                    }} />
                  ))}
                </div>
              )}

              {!historyLoading && history.map((enc, idx) => (
                <div key={enc.ipfsHash} style={{
                  position: 'relative',
                  paddingLeft: 24,
                  marginBottom: idx < history.length - 1 ? 0 : 0,
                }}>
                  {/* Timeline connector line */}
                  {idx < history.length - 1 && (
                    <div style={{
                      position: 'absolute', left: 7, top: 28,
                      width: 2, bottom: -8,
                      background: 'rgba(255,255,255,0.08)',
                    }} />
                  )}
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: 0, top: 16,
                    width: 14, height: 14, borderRadius: '50%',
                    background: idx === 0 ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                    border: `2px solid ${idx === 0 ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}`,
                    flexShrink: 0,
                  }} />

                  <div style={{
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    marginBottom: 8,
                  }}>
                    {/* Card header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 700,
                        background: idx === 0 ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)',
                        color: idx === 0 ? 'var(--accent)' : 'var(--muted)',
                        padding: '3px 10px', borderRadius: 20,
                        border: `1px solid ${idx === 0 ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)'}`,
                      }}>
                        {enc.label}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                        {formatDate(enc.timestamp)}
                      </span>
                    </div>

                    {/* Doctor + department */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text)', fontWeight: 600 }}>
                        👨‍⚕️ {enc.doctorName}
                      </span>
                      {enc.department && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                          · {enc.department}
                        </span>
                      )}
                    </div>

                    {/* Clinical fields */}
                    {enc.symptoms && (
                      <div className="record-field">
                        <span className="field-label">Symptoms</span>
                        <span className="field-value">{enc.symptoms}</span>
                      </div>
                    )}
                    <div className="record-field">
                      <span className="field-label">🩺 Diagnosis</span>
                      <span className="field-value diagnosis">{enc.diagnosis}</span>
                    </div>
                    <div className="record-field">
                      <span className="field-label">💊 Medication</span>
                      <span className="field-value">{enc.medication} — {enc.dosage}</span>
                    </div>
                    {enc.instructions && (
                      <div className="record-field">
                        <span className="field-label">Instructions</span>
                        <span className="field-value">{enc.instructions}</span>
                      </div>
                    )}
                    {enc.allergies && (
                      <div className="record-field">
                        <span className="field-label">Allergies</span>
                        <span className="field-value">{enc.allergies}</span>
                      </div>
                    )}
                    {enc.existingConditions && (
                      <div className="record-field">
                        <span className="field-label">Conditions</span>
                        <span className="field-value">{enc.existingConditions}</span>
                      </div>
                    )}

                    {/* IPFS provenance */}
                    <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      ⛓ {enc.ipfsHash}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
