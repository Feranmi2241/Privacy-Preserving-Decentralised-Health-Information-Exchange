import { useState } from 'react';
import './AuthPage.css';

declare global {
  interface Window {
    ethereum?: any;
  }
}

type AuthStep = 'login' | 'register' | 'verify-otp' | 'forgot' | 'reset-password' | 'connect-wallet';

interface Props { onAuth: (token: string, hospitalName: string, rsaKey: string, email: string) => void; }

const API = import.meta.env.VITE_API_URL;

const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

/* ── Reusable field ── */
function Field({
  icon, label, hint, children,
}: {
  icon: string; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="cl-field-group">
      <label className="cl-field-label">{label}</label>
      <div className="cl-field-wrap">
        <span className="material-symbols-outlined cl-field-icon">{icon}</span>
        {children}
        <div className="cl-field-bar" />
      </div>
      {hint && <p className="cl-field-hint">{hint}</p>}
    </div>
  );
}

/* ── Sidebar — CSS gradient background, no external image ── */
function Sidebar() {
  return (
    <aside className="cl-sidebar">
      {/* CSS gradient replaces the external Google-hosted image */}
      <div className="cl-sidebar-bg" />
      <div className="cl-sidebar-top">
        <div className="cl-logo">
          <span className="material-symbols-outlined cl-logo-icon">clinical_notes</span>
          <span className="cl-logo-text">Clinical Ledger</span>
        </div>
        <h1 className="cl-headline">
          The Immutable{' '}
          <span className="cl-headline-accent">Sanctuary</span>{' '}
          for Clinical Data.
        </h1>
        <div className="cl-features">
          {[
            { icon: 'shield_lock', title: 'Blockchain Security', desc: 'End-to-end immutable audit trails for every patient interaction.' },
            { icon: 'hub',         title: 'Unified Network',     desc: 'Connect with verified providers across the secure medical ledger.' },
          ].map(f => (
            <div key={f.icon} className="cl-feature">
              <div className="cl-feature-icon-wrap">
                <span className="material-symbols-outlined cl-feature-icon" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {f.icon}
                </span>
              </div>
              <div>
                <p className="cl-feature-title">{f.title}</p>
                <p className="cl-feature-desc">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="cl-node-status-wrap">
        <div className="cl-node-status">
          <p className="cl-node-status-label">Node Status</p>
          <div className="cl-node-status-row">
            <div className="cl-pulse-dot" />
            <p className="cl-node-status-text">Blockchain Node Active</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ══════════════════════════════════════════
   LOGIN LAYOUT
══════════════════════════════════════════ */
interface LoginProps {
  form: { email: string; password: string };
  set: (k: string, v: string) => void;
  loading: boolean;
  error: string;
  info: string;
  handle: (e: React.FormEvent) => void;
  nav: (s: AuthStep) => void;
}

function LoginPage({ form, set, loading, error, info, handle, nav }: LoginProps) {
  return (
    <div className="login-shell">
      <div className="login-blob-tl" />
      <div className="login-blob-br" />

      <main className="login-card">
        {/* Left branding column — CSS gradient, no external image */}
        <section className="login-left">
          <div className="login-left-bg" />

          <div className="login-left-top">
            <div className="login-brand">
              <span className="material-symbols-outlined login-brand-icon">enhanced_encryption</span>
              <span className="login-brand-name">Clinical Ledger</span>
            </div>
          </div>

          <div className="login-left-mid">
            <h2 className="login-left-headline">
             	Clinical Ledger for Health <br /> Information Exchange
            </h2>
            <p className="login-left-sub">
              A blockchain-based health information exchange with patient-controlled,
               per-hospital access.
            </p>
          </div>

          <div className="login-left-bottom">
            <div className="login-glass-card">
              <p className="login-glass-label">Network Status</p>
              <div className="login-glass-row">
                <div className="login-glass-dot" />
                <span className="login-glass-node">Blockchain Node Active</span>
              </div>
            </div>
            <p className="login-copyright">© 2024 Clinical Ledger Protocol. All rights reserved.</p>
          </div>
        </section>

        {/* Right form column */}
        <section className="login-right">
          <div className="login-form-inner">
            <header className="login-form-header">
              <h3 className="login-form-title">Hospital Sign In</h3>
              <p className="login-form-sub">Enter your credentials to access the ledger.</p>
            </header>

            <form onSubmit={handle} className="login-form">
              <div className="login-field">
                <label className="login-field-label" htmlFor="login-email">Hospital Email Address</label>
                <div className="login-input-wrap">
                  <span className="material-symbols-outlined login-input-icon">mail</span>
                  <input
                    id="login-email"
                    className="login-input"
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="admin@hospital.org"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <div className="login-field-header">
                  <label className="login-field-label" htmlFor="login-password">Password</label>
                  <button type="button" className="login-forgot" onClick={() => nav('forgot')}>
                    Forgot Password?
                  </button>
                </div>
                <div className="login-input-wrap">
                  <span className="material-symbols-outlined login-input-icon">lock_open</span>
                  <input
                    id="login-password"
                    className="login-input"
                    type="password"
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <div className="login-security-chip">
                <span className="material-symbols-outlined login-security-icon">verified_user</span>
                <div>
                  <p className="login-security-title">AES-256 + RSA-2048 Encrypted</p>
                  <p className="login-security-desc">
                    All patient records are hybrid-encrypted before storage on IPFS and anchored on the Ethereum blockchain.
                  </p>
                </div>
              </div>

              <button type="submit" disabled={loading} className="login-btn">
                {loading ? (
                  <><span className="cl-spinner" />Processing...</>
                ) : (
                  <>
                    Authorize Access
                    <span className="material-symbols-outlined login-btn-icon">arrow_forward</span>
                  </>
                )}
              </button>
            </form>

            {error && (
              <div className="cl-alert cl-alert-error">
                <span className="material-symbols-outlined cl-alert-icon">error</span>
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="cl-alert cl-alert-success">
                <span className="material-symbols-outlined cl-alert-icon">check_circle</span>
                <span>{info}</span>
              </div>
            )}

            <footer className="login-footer">
              <p className="login-footer-text">New facility node?</p>
              <button className="login-register-btn" onClick={() => nav('register')}>
                Request Institutional Onboarding
              </button>
              <div className="login-protocol-row">
                <span className="login-protocol-label">Secured by</span>
                <div className="login-protocol-icons">
                  {['hub', 'lock'].map(ic => (
                    <div key={ic} className="login-protocol-icon">
                      <span className="material-symbols-outlined">{ic}</span>
                    </div>
                  ))}
                </div>
              </div>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════
   AUTH PAGE (root)
══════════════════════════════════════════ */
export default function AuthPage({ onAuth }: Props) {
  const [step, setStep]         = useState<AuthStep>('login');
  const [form, setForm]         = useState({ name: '', email: '', password: '', code: '', newPassword: '', termsAccepted: false });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [info,  setInfo]        = useState('');
  const [pendingEmail, setPendingEmail]   = useState('');
  const [rsaPrivateKey, setRsaPrivateKey] = useState('');
  const [keyWarning, setKeyWarning]       = useState('');
  const [keyCopied, setKeyCopied]         = useState(false);
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);
  const [showKeyModal, setShowKeyModal]   = useState(false);

  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }));
    setError(''); setInfo('');
  };

  const post = async (path: string, body: object) => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setInfo('');
    try {
      if (step === 'login') {
        const data = await post('/auth/login', { email: form.email, password: form.password });
        onAuth(data.token, data.hospitalName, '', form.email);

      } else if (step === 'register') {
        if (!form.termsAccepted) {
          setError('You must accept the Immutable Ledger Governance Protocol to register.');
          return;
        }
        if (!STRONG_PW.test(form.password)) {
          setError('Password needs ≥8 chars, upper, lower, digit & special character.');
          return;
        }
        await post('/auth/register', {
          name: form.name,
          email: form.email,
          password: form.password,
          termsAccepted: form.termsAccepted,
        });
        setInfo('OTP sent to your email. Enter it below.');
        setStep('verify-otp');

      } else if (step === 'verify-otp') {
        const data = await post('/auth/verify-otp', { email: form.email, code: form.code });
        if (data.rsaPrivateKey) {
          setRsaPrivateKey(data.rsaPrivateKey);
          setKeyWarning(data.keyWarning || 'Save this private key — it will never be shown again.');
          setShowKeyModal(true);
        }
        setPendingEmail(form.email);
        // Step transition happens after modal acknowledgment, not here

      } else if (step === 'forgot') {
        await post('/auth/forgot-password', { email: form.email });
        setInfo('If that email exists, an OTP was sent.');
        setStep('reset-password');

      } else if (step === 'reset-password') {
        if (!STRONG_PW.test(form.newPassword)) {
          setError('Password needs ≥8 chars, upper, lower, digit & special character.');
          return;
        }
        await post('/auth/reset-password', { email: form.email, code: form.code, newPassword: form.newPassword });
        setInfo('Password reset! You can now log in.');
        setStep('login');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const connectWallet = async () => {
    setLoading(true); setError(''); setInfo('');
    try {
      // Point 1 — check MetaMask exists
      if (!window.ethereum) {
        setError('MetaMask (or another Ethereum wallet browser extension) is required to continue. Install it at https://metamask.io');
        return;
      }

      // Point 2 — request accounts
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const walletAddress = accounts[0];
      if (!walletAddress) {
        setError('No account found. Please unlock MetaMask and try again.');
        return;
      }

      // Point 3 — verify Sepolia network
      const chainId: string = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== '0xaa36a7') {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xaa36a7' }],
          });
        } catch (switchErr: any) {
          if (switchErr.code === 4001) {
            setError('You must switch to the Sepolia test network to continue.');
          } else {
            setError('Failed to switch network: ' + (switchErr.message || 'Unknown error'));
          }
          return;
        }
      }

      // Point 4 — get nonce message from backend
      const token = sessionStorage.getItem('cl_token');
      const nonceRes = await fetch(`${API}/auth/wallet-nonce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: pendingEmail }),
      });
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceData.error || 'Failed to get nonce');
      const message: string = nonceData.message;

      // Point 5 — sign the message (no gas, just a signature prompt)
      const { BrowserProvider } = await import('ethers');
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      let signature: string;
      try {
        signature = await signer.signMessage(message);
      } catch (signErr: any) {
        if (signErr.code === 4001 || signErr.code === 'ACTION_REJECTED') {
          setError('Signature rejected. You must sign the message to link your wallet.');
        } else {
          setError('Signing failed: ' + (signErr.message || 'Unknown error'));
        }
        return;
      }

      // Point 6 — verify signature on backend
      const verifyRes = await fetch(`${API}/auth/wallet-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: pendingEmail, walletAddress, signature }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Wallet verification failed');

      // Point 7 — success
      setInfo('Wallet connected! You can now log in.');
      setStep('login');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const nav = (s: AuthStep) => { setStep(s); setError(''); setInfo(''); };

  /* ── RSA Key Modal ── */
  if (showKeyModal) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 40, maxWidth: 560, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#b45309' }}>warning</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#92400e' }}>Save Your RSA Private Key</h2>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#3f4949', marginBottom: 16, lineHeight: 1.6 }}>{keyWarning}</p>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <textarea
              readOnly
              value={rsaPrivateKey}
              rows={8}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem', padding: '12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#f9fafb', resize: 'none', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(rsaPrivateKey); setKeyCopied(true); }}
              style={{ position: 'absolute', top: 10, right: 10, padding: '6px 14px', borderRadius: 8, border: 'none', background: keyCopied ? '#16a34a' : '#0047d6', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{keyCopied ? 'check' : 'content_copy'}</span>
              {keyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 24 }}>
            <input
              type="checkbox"
              checked={keyAcknowledged}
              onChange={e => setKeyAcknowledged(e.target.checked)}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <span style={{ fontSize: '0.875rem', color: '#3f4949' }}>
              I have saved this private key somewhere safe. I understand it cannot be recovered if lost.
            </span>
          </label>
          <button
            type="button"
            disabled={!keyAcknowledged}
            onClick={() => { setShowKeyModal(false); setStep('connect-wallet'); }}
            className="cl-btn-primary"
            style={{ opacity: keyAcknowledged ? 1 : 0.5, cursor: keyAcknowledged ? 'pointer' : 'not-allowed' }}
          >
            <span>Continue to Wallet Setup</span>
            <span className="material-symbols-outlined cl-btn-icon">arrow_forward</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === 'login') {
    return (
      <LoginPage
        form={form} set={set}
        loading={loading} error={error} info={info}
        handle={handle} nav={nav}
      />
    );
  }

  const meta: Record<Exclude<AuthStep, 'login'>, { title: string; sub: string; btnLabel: string; btnIcon: string }> = {
    register:         { title: 'Hospital Registration',  sub: "Initialize your facility's encrypted node on the network.",                  btnLabel: 'Register Facility', btnIcon: 'arrow_forward'          },
    'verify-otp':     { title: 'Verify Your Email',      sub: `Enter the 6-digit code sent to ${form.email || 'your email'}.`,              btnLabel: 'Verify OTP',        btnIcon: 'verified'               },
    forgot:           { title: 'Account Recovery',       sub: 'Enter your registered hospital email to receive a reset OTP.',               btnLabel: 'Send Reset OTP',    btnIcon: 'send'                   },
    'reset-password': { title: 'Reset Password',         sub: `Enter the OTP sent to ${form.email || 'your email'} and your new password.`, btnLabel: 'Reset Password',    btnIcon: 'lock_reset'             },
    'connect-wallet': { title: 'Connect Your Wallet',    sub: "Link an Ethereum wallet to sign and verify your hospital's records on-chain.", btnLabel: 'Connect Wallet',    btnIcon: 'account_balance_wallet' },
  };

  const { title, sub, btnLabel, btnIcon } = meta[step as Exclude<AuthStep, 'login'>];

  return (
    <div className="cl-root">
      <Sidebar />

      <main className="cl-main">
        <div className="cl-form-container">

          <div className="cl-mobile-logo">
            <span className="material-symbols-outlined cl-mobile-logo-icon">clinical_notes</span>
            <span className="cl-mobile-logo-text">Clinical Ledger</span>
          </div>

          <header className="cl-step-header">
            <h2 className="cl-step-title">{title}</h2>
            <p className="cl-step-sub">{sub}</p>
          </header>

          {step === 'connect-wallet' ? (
            <div className="cl-form">
              {!window.ethereum && (
                <div className="cl-alert cl-alert-error">
                  <span className="material-symbols-outlined cl-alert-icon">error</span>
                  <span>
                    MetaMask (or another Ethereum wallet browser extension) is required.{' '}
                    <a href="https://metamask.io" target="_blank" rel="noreferrer" className="cl-link">Install MetaMask</a>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="cl-btn-primary"
                onClick={connectWallet}
                disabled={loading}
              >
                {loading ? (
                  <><span className="cl-spinner" />Connecting...</>
                ) : (
                  <>
                    <span>Connect Wallet</span>
                    <span className="material-symbols-outlined cl-btn-icon">account_balance_wallet</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <form onSubmit={handle} className="cl-form">
            {step === 'register' && (
              <Field icon="local_hospital" label="Hospital Name">
                <input
                  className="cl-input"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="St. Margaret's Medical Center"
                  autoComplete="organization"
                  required
                />
              </Field>
            )}

            {(step === 'register' || step === 'forgot' || step === 'reset-password') && (
              <Field icon="mail" label="Hospital Email Address">
                <input
                  className="cl-input"
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="admin@hospital.org"
                  autoComplete="email"
                  required
                />
              </Field>
            )}

            {step === 'register' && (
              <Field
                icon="enhanced_encryption"
                label="Secure Password"
                hint="Must include ≥8 characters, 1 uppercase, 1 digit and 1 special character."
              >
                <input
                  className="cl-input"
                  type="password"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="new-password"
                  required
                />
              </Field>
            )}

            {(step === 'verify-otp' || step === 'reset-password') && (
              <Field icon="pin" label="OTP Code">
                <input
                  className="cl-input"
                  value={form.code}
                  onChange={e => set('code', e.target.value)}
                  placeholder="6-digit code"
                  maxLength={6}
                  inputMode="numeric"
                  required
                />
              </Field>
            )}

            {step === 'reset-password' && (
              <Field
                icon="lock_reset"
                label="New Password"
                hint="Must include ≥8 characters, 1 uppercase, 1 digit and 1 special character."
              >
                <input
                  className="cl-input"
                  type="password"
                  value={form.newPassword}
                  onChange={e => set('newPassword', e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="new-password"
                  required
                />
              </Field>
            )}

            {step === 'register' && (
              <div className="cl-terms-row">
                <input
                  type="checkbox"
                  id="cl-terms"
                  className="cl-terms-checkbox"
                  checked={form.termsAccepted}
                  onChange={e => set('termsAccepted', e.target.checked)}
                  required
                />
                <label htmlFor="cl-terms" className="cl-terms-label">
                  I agree to the{' '}
                  <span className="cl-terms-link">Immutable Ledger Governance Protocol</span>.
                </label>
              </div>
            )}

            <button type="submit" disabled={loading} className="cl-btn-primary">
              {loading ? (
                <><span className="cl-spinner" />Processing...</>
              ) : (
                <>
                  <span>{btnLabel}</span>
                  <span className="material-symbols-outlined cl-btn-icon">{btnIcon}</span>
                </>
              )}
            </button>
          </form>
          )}

          {error && (
            <div className="cl-alert cl-alert-error">
              <span className="material-symbols-outlined cl-alert-icon">error</span>
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="cl-alert cl-alert-success">
              <span className="material-symbols-outlined cl-alert-icon">check_circle</span>
              <span>{info}</span>
            </div>
          )}

          <footer className="cl-footer">
            {step === 'register' && (
              <p className="cl-footer-text-last">
                Already managing a node?{' '}
                <button className="cl-link" onClick={() => nav('login')}>Authenticate here</button>
              </p>
            )}
            {(step === 'verify-otp' || step === 'forgot' || step === 'reset-password') && (
              <button className="cl-link" onClick={() => nav('login')}>← Back to login</button>
            )}

            <div className="cl-trust-badges">
              {[
                { icon: 'verified', label: 'HIPAA Aligned' },
                { icon: 'security', label: 'AES-256 Encrypted' },
              ].map(b => (
                <div key={b.label} className="cl-trust-badge">
                  <span className="material-symbols-outlined cl-trust-badge-icon">{b.icon}</span>
                  <span className="cl-trust-badge-label">{b.label}</span>
                </div>
              ))}
            </div>
          </footer>

        </div>
      </main>
    </div>
  );
}
