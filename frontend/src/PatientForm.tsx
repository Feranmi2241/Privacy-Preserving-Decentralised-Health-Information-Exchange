import { useState, useRef } from 'react';

interface FormState {
  patientId: string; fullName: string; dateOfBirth: string; patientEmail: string;
  phone: string; address: string;
  allergies: string; existingConditions: string; bloodGroup: string;
  symptoms: string; diagnosis: string;
  medication: string; dosage: string; instructions: string;
  doctorName: string; department: string;
  profilePhoto: string; // base64 data URL — encrypted with the record on IPFS
}

interface Result { txHash: string; ipfsHash: string; hadPhoto: boolean; }

const EMPTY: FormState = {
  patientId: '', fullName: '', dateOfBirth: '', patientEmail: '',
  phone: '', address: '',
  allergies: '', existingConditions: '', bloodGroup: '',
  symptoms: '', diagnosis: '',
  medication: '', dosage: '', instructions: '',
  doctorName: '', department: '',
  profilePhoto: '',
};

const PATIENT_ID_REGEX = /^[A-Za-z0-9\-]+$/;

const REQUIRED_FIELDS: (keyof FormState)[] = [
  'patientId', 'fullName', 'dateOfBirth', 'patientEmail', 'phone', 'address',
  'bloodGroup', 'symptoms', 'diagnosis',
  'medication', 'dosage', 'instructions', 'doctorName', 'department',
];

const BLOOD_GROUPS = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];

/* ── Section divider ── */
function Section({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '32px 0 20px',
      paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(59,130,246,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.95rem', flexShrink: 0,
      }}>{icon}</div>
      <span style={{
        fontSize: '0.7rem', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        color: 'var(--muted)',
      }}>{title}</span>
    </div>
  );
}

/* ── Single form field ── */
function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="form-group">
      <label>
        {label}
        {required
          ? <span style={{ color: 'var(--error)', marginLeft: 4 }}>*</span>
          : <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6, fontSize: '0.72rem', textTransform: 'none' }}>(optional)</span>}
      </label>
      {children}
    </div>
  );
}

export default function PatientForm({ token, onRecordAdded }: { token: string; onRecordAdded?: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [photoDragging, setPhotoDragging] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof FormState, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setResult(null); setError('');
  };

  /* ── Profile photo handler ── */
  const handlePhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please select a valid image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Photo must be under 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = e => set('profilePhoto', e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = REQUIRED_FIELDS.find(f => !form[f].trim());
    if (missing) { setError('Please fill in all required fields.'); return; }
    if (!PATIENT_ID_REGEX.test(form.patientId.trim())) {
      setError('Patient ID may only contain letters, digits and hyphens (e.g. PAT-2024-001).');
      return;
    }

    setLoading(true); setError(''); setResult(null);
    try {
      const hadPhoto = !!form.profilePhoto;
      const res = await fetch(`${import.meta.env.VITE_API_URL}/add-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setResult({ ...data, hadPhoto });
      setForm(EMPTY);
      if (onRecordAdded) onRecordAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>

      {/* ══ FORM HEADER BANNER ══ */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,70,74,0.95) 0%, rgba(0,96,100,0.95) 100%)',
        padding: '28px 32px 24px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 160, height: 160,
          background: 'rgba(255,255,255,0.04)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: -20, left: 80,
          width: 100, height: 100,
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '50%',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: '1.3rem' }}>🩺</span>
            <h2 style={{
              fontFamily: 'Manrope, sans-serif', fontWeight: 800,
              fontSize: '1.25rem', color: '#ffffff', letterSpacing: '-0.02em',
            }}>Add Patient Record</h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
            All fields marked <span style={{ color: '#f87171' }}>*</span> are required.
            Record is AES-256 encrypted before storage on IPFS + Blockchain.
          </p>
        </div>
      </div>

      <div style={{ padding: '0 32px 32px' }}>
        <form onSubmit={handleSubmit}>

          {/* ══════════════════════════════════════
              PROFILE PHOTO SECTION
          ══════════════════════════════════════ */}
          <Section icon="👤" title="Patient Profile Photo" />

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            padding: '28px 24px',
            background: 'var(--surface2)',
            borderRadius: 16,
            border: `2px dashed ${photoDragging ? 'var(--accent)' : 'var(--border)'}`,
            transition: 'border-color 0.2s ease, background 0.2s ease',
            cursor: 'pointer',
            position: 'relative',
          }}
            onClick={() => photoInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setPhotoDragging(true); }}
            onDragLeave={() => setPhotoDragging(false)}
            onDrop={e => {
              e.preventDefault(); setPhotoDragging(false);
              handlePhoto(e.dataTransfer.files[0] ?? null);
            }}
          >
            {/* Hidden file input */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handlePhoto(e.target.files?.[0] ?? null)}
            />

            {/* Avatar preview */}
            <div style={{
              width: 120, height: 120,
              borderRadius: '50%',
              border: '3px solid var(--border)',
              overflow: 'hidden',
              background: 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              boxShadow: form.profilePhoto
                ? '0 0 0 4px rgba(59,130,246,0.25), 0 8px 24px rgba(0,0,0,0.3)'
                : '0 4px 16px rgba(0,0,0,0.2)',
              transition: 'box-shadow 0.3s ease',
              position: 'relative',
            }}>
              {form.profilePhoto ? (
                <img
                  src={form.profilePhoto}
                  alt="Patient"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: 4, opacity: 0.3 }}>👤</div>
                </div>
              )}
            </div>

            {/* Upload instructions */}
            <div style={{ textAlign: 'center' }}>
              <p style={{
                fontSize: '0.875rem', fontWeight: 600,
                color: 'var(--text)', marginBottom: 4,
              }}>
                {form.profilePhoto ? 'Photo uploaded ✓' : 'Upload Patient Photo'}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                {form.profilePhoto
                  ? 'Click to change · Drag & drop a new image'
                  : 'Click to browse · Drag & drop · JPG, PNG, WEBP · Max 5 MB'}
              </p>
              <p style={{
                fontSize: '0.68rem', color: 'rgba(59,130,246,0.7)',
                marginTop: 6, fontStyle: 'italic',
              }}>
                🔒 Photo is AES-256 encrypted and stored exclusively with this patient's record on IPFS
              </p>
            </div>

            {/* Remove button */}
            {form.profilePhoto && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); set('profilePhoto', ''); }}
                style={{
                  position: 'absolute', top: 12, right: 12,
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#fca5a5', fontSize: '0.75rem',
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.2s ease',
                }}
              >✕</button>
            )}
          </div>

          {/* ══════════════════════════════════════
              PATIENT IDENTIFICATION
          ══════════════════════════════════════ */}
          <Section icon="🪪" title="Patient Identification" />

          <Field label="Patient ID" required>
            <input
              value={form.patientId}
              onChange={e => set('patientId', e.target.value)}
              placeholder="e.g. PAT-2024-001"
              autoComplete="off"
            />
          </Field>

          <Field label="Full Name" required>
            <input
              value={form.fullName}
              onChange={e => set('fullName', e.target.value)}
              placeholder="e.g. Oyeniyi Feranmi"
              autoComplete="off"
            />
          </Field>

          <Field label="Date of Birth" required>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={e => set('dateOfBirth', e.target.value)}
            />
          </Field>

          <Field label="Patient Email Address" required>
            <input
              type="email"
              value={form.patientEmail}
              onChange={e => set('patientEmail', e.target.value)}
              placeholder="e.g. patient@email.com"
              autoComplete="off"
            />
          </Field>

          {/* ══════════════════════════════════════
              CONTACT INFORMATION
          ══════════════════════════════════════ */}
          <Section icon="📞" title="Contact Information" />

          <Field label="Phone Contact" required>
            <input
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
              placeholder="e.g. +234 800 000 0000"
              autoComplete="off"
            />
          </Field>

          <Field label="Address" required>
            <textarea
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="e.g. 12 Hospital Road, Lagos"
            />
          </Field>

          {/* ══════════════════════════════════════
              MEDICAL SUMMARY
          ══════════════════════════════════════ */}
          <Section icon="🩸" title="Medical Summary" />

          <Field label="Allergies">
            <textarea
              value={form.allergies}
              onChange={e => set('allergies', e.target.value)}
              placeholder="e.g. Penicillin, Peanuts"
            />
          </Field>

          <Field label="Existing Conditions">
            <textarea
              value={form.existingConditions}
              onChange={e => set('existingConditions', e.target.value)}
              placeholder="e.g. Diabetes, Hypertension"
            />
          </Field>

          <Field label="Blood Group" required>
            <select
              value={form.bloodGroup}
              onChange={e => set('bloodGroup', e.target.value)}
              style={{
                width: '100%',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
                color: form.bloodGroup ? 'var(--text)' : 'var(--muted)',
                fontSize: '0.9rem',
                outline: 'none',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <option value="">Select blood group</option>
              {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>

          {/* ══════════════════════════════════════
              VISIT INFORMATION
          ══════════════════════════════════════ */}
          <Section icon="🏥" title="Visit Information" />

          <Field label="Symptoms / Complaint" required>
            <textarea
              value={form.symptoms}
              onChange={e => set('symptoms', e.target.value)}
              placeholder="Describe presenting symptoms..."
            />
          </Field>

          <Field label="Diagnosis / Clinical Notes" required>
            <textarea
              value={form.diagnosis}
              onChange={e => set('diagnosis', e.target.value)}
              placeholder="Enter clinical diagnosis and notes..."
            />
          </Field>

          {/* ══════════════════════════════════════
              TREATMENT / PRESCRIPTION
          ══════════════════════════════════════ */}
          <Section icon="💊" title="Treatment / Prescription" />

          <Field label="Medication Given" required>
            <input
              value={form.medication}
              onChange={e => set('medication', e.target.value)}
              placeholder="e.g. Amoxicillin 500mg"
              autoComplete="off"
            />
          </Field>

          <Field label="Dosage" required>
            <input
              value={form.dosage}
              onChange={e => set('dosage', e.target.value)}
              placeholder="e.g. 1 tablet 3× daily"
              autoComplete="off"
            />
          </Field>

          <Field label="Instructions" required>
            <textarea
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder="e.g. Take after meals, complete full course"
            />
          </Field>

          {/* ══════════════════════════════════════
              DOCTOR INFORMATION
          ══════════════════════════════════════ */}
          <Section icon="👨‍⚕️" title="Doctor Information" />

          <Field label="Doctor's Name" required>
            <input
              value={form.doctorName}
              onChange={e => set('doctorName', e.target.value)}
              placeholder="e.g. Dr. Amara Okafor"
              autoComplete="off"
            />
          </Field>

          <Field label="Department" required>
            <input
              value={form.department}
              onChange={e => set('department', e.target.value)}
              placeholder="e.g. Internal Medicine"
              autoComplete="off"
            />
          </Field>

          {/* ── Timestamp notice ── */}
          <div style={{
            marginTop: 24,
            padding: '12px 16px',
            background: 'rgba(59,130,246,0.06)',
            borderRadius: 10,
            border: '1px solid rgba(59,130,246,0.15)',
            fontSize: '0.78rem',
            color: 'var(--muted)',
            marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>🕐</span>
            <span>Date &amp; Time will be automatically recorded at the moment of blockchain storage.</span>
          </div>

          {/* ── Submit ── */}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading
              ? <><span className="spinner" /> Encrypting &amp; Submitting to Chain...</>
              : <><span>⛓️</span> Store on Blockchain</>}
          </button>
        </form>

        {/* ── Success ── */}
        {result && (
          <div className="alert alert-success" style={{ marginTop: 20 }}>
            <span className="alert-icon">✅</span>
            <div className="alert-body">
              <strong>Record stored successfully!</strong>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Tx Hash: <code>{result.txHash}</code></span>
                <span>IPFS CID: <code>{result.ipfsHash}</code></span>
                {result && result.hadPhoto && (
                  <span style={{ fontSize: '0.75rem', color: '#6ee7b7', marginTop: 2 }}>
                    🖼️ Patient photo encrypted and stored on IPFS with this record.
                  </span>
                )}
                <span style={{ fontSize: '0.78rem', color: '#6ee7b7', marginTop: 2 }}>
                  📧 Confirmation with Tx Hash &amp; IPFS CID has been sent to your registered email.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 20 }}>
            <span className="alert-icon">⚠️</span>
            <div className="alert-body"><strong>Error: </strong>{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
