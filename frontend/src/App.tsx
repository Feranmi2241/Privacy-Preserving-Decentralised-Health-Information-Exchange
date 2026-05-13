import { useState, useEffect, useCallback } from 'react';
import AuthPage from './AuthPage';
import PatientForm from './PatientForm';
import RecordViewer from './RecordViewer';
import './index.css';
import './dashboard.css';

type Tab = 'add' | 'view' | 'all';

interface NetworkStatus {
  blockNumber: number;
  lastBlockHash: string;
  networkName: string;
  nodeStatus: string;
}

/* ── Avatar: initials from hospital name ── */
function HospitalAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="ds-avatar ds-avatar-initials">
      <span>{initials || 'HL'}</span>
    </div>
  );
}

/* ══════════════════════════════════════════
   ALL PATIENTS
══════════════════════════════════════════ */
function AllPatients({ token }: { token: string }) {
  const [ids, setIds]       = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/records/all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setIds(d.patientIds); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="ds-fade-in">
      <div className="ds-card-header-row">
        <div className="ds-card-icon">
          <span className="material-symbols-outlined">folder_managed</span>
        </div>
        <div>
          <p className="ds-card-title">All Patient IDs on Blockchain</p>
          <p className="ds-card-sub">Read directly from the smart contract — scoped to your hospital node.</p>
        </div>
      </div>

      {!loading && !error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          background: 'rgba(0,71,214,0.06)',
          border: '1px solid rgba(0,71,214,0.12)',
          borderRadius: 12, marginBottom: 20,
        }}>
          <span className="ds-badge ds-badge-verified" style={{ fontSize: '0.75rem' }}>⛓ On-Chain</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--ds-on-surface-variant)' }}>
            Total Patients Stored:{' '}
            <strong style={{ color: 'var(--ds-on-surface)' }}>{ids.length}</strong>
          </span>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              height: 52, borderRadius: 12,
              background: 'linear-gradient(90deg,#f0f4f8 25%,#e4e9ed 50%,#f0f4f8 75%)',
              backgroundSize: '400px 100%',
              animation: 'shimmer 1.4s infinite',
            }} />
          ))}
        </div>
      )}

      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 16px', borderRadius: 10,
          background: 'rgba(186,26,26,0.07)',
          border: '1px solid rgba(186,26,26,0.18)',
          color: '#93000a', fontSize: '0.875rem',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        ids.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ds-on-surface-variant)', fontSize: '0.875rem' }}>
            No records found on the blockchain yet.
          </div>
        ) : (
          <div className="ds-ledger-list">
            {ids.map((id, i) => (
              <div key={id} className="ds-ledger-entry">
                <div className="ds-ledger-entry-left">
                  <div className="ds-ledger-entry-icon">
                    <span className="material-symbols-outlined">description</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p className="ds-ledger-entry-name">#{i + 1}</p>
                    <p className="ds-ledger-entry-desc" style={{ fontFamily: 'Courier New, monospace', letterSpacing: '0.02em' }}>{id}</p>
                  </div>
                </div>
                <span className="ds-badge ds-badge-verified">✓ Stored</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════ */
interface SidebarProps {
  tab: Tab;
  setTab: (t: Tab) => void;
  hospitalName: string;
  onSignOut: () => void;
  open: boolean;
  onClose: () => void;
}

function Sidebar({ tab, setTab, hospitalName, onSignOut, open, onClose }: SidebarProps) {
  const navItems: { key: Tab; icon: string; label: string }[] = [
    { key: 'add',  icon: 'person_add',          label: 'Add Record'      },
    { key: 'view', icon: 'folder_managed',       label: 'View Record'     },
    { key: 'all',  icon: 'enhanced_encryption',  label: 'All Patient IDs' },
  ];

  return (
    <>
      <div className={`ds-sidebar-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`ds-sidebar${open ? ' open' : ''}`}>
        <div className="ds-sidebar-brand">
          <p className="ds-sidebar-brand-name">Clinical Ledger</p>
          <p className="ds-sidebar-brand-node">
            {hospitalName ? `🏥 ${hospitalName}` : 'Verified Node'}
          </p>
        </div>

        <nav className="ds-nav">
          {navItems.map(item => (
            <button
              key={item.key}
              className={`ds-nav-item${tab === item.key ? ' active' : ''}`}
              onClick={() => { setTab(item.key); onClose(); }}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="ds-sidebar-bottom">
          <div className="ds-sidebar-links">
            <button className="ds-sidebar-link" onClick={onSignOut} style={{ color: '#ba1a1a' }}>
              <span className="material-symbols-outlined">logout</span>
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ══════════════════════════════════════════
   APP ROOT
══════════════════════════════════════════ */
export default function App() {
  // Persist token in sessionStorage so page refresh doesn't force re-login
  const [token, setToken]               = useState(() => sessionStorage.getItem('cl_token') || '');
  const [hospitalName, setHospitalName] = useState(() => sessionStorage.getItem('cl_hospital') || '');
  const [tab, setTab]                   = useState<Tab>('add');
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [network, setNetwork]           = useState<NetworkStatus | null>(null);
  const [recentIds, setRecentIds]       = useState<string[]>([]);

  const handleAuth = (t: string, h: string) => {
    sessionStorage.setItem('cl_token', t);
    sessionStorage.setItem('cl_hospital', h);
    setToken(t);
    setHospitalName(h);
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('cl_token');
    sessionStorage.removeItem('cl_hospital');
    setToken('');
    setHospitalName('');
  };

  // Fetch real network status from blockchain
  const fetchNetwork = useCallback(() => {
    if (!token) return;
    fetch(`${import.meta.env.VITE_API_URL}/network/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setNetwork(d); })
      .catch(() => {/* non-fatal */});
  }, [token]);

  // Fetch real recent patient IDs for the ledger entries panel
  const fetchRecentIds = useCallback(() => {
    if (!token) return;
    fetch(`${import.meta.env.VITE_API_URL}/records/all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setRecentIds((d.patientIds as string[]).slice(-5).reverse()); })
      .catch(() => {/* non-fatal */});
  }, [token]);

  useEffect(() => {
    fetchNetwork();
    fetchRecentIds();
    // Refresh every 30 seconds
    const id = setInterval(() => { fetchNetwork(); fetchRecentIds(); }, 30_000);
    return () => clearInterval(id);
  }, [fetchNetwork, fetchRecentIds]);

  if (!token) {
    return <AuthPage onAuth={handleAuth} />;
  }

  const truncateHash = (h: string) =>
    h && h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h;

  return (
    <div className="ds-body">
      <Sidebar
        tab={tab} setTab={setTab}
        hospitalName={hospitalName}
        onSignOut={handleSignOut}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="ds-main">
        {/* Top bar */}
        <header className="ds-topbar">
          <div className="ds-topbar-inner">
            <div className="ds-topbar-left">
              <button className="ds-mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="ds-topbar-title">Clinical Ledger</span>
              <nav className="ds-topbar-nav">
                {(['add', 'view', 'all'] as Tab[]).map((t, i) => {
                  const labels = ['Add Record', 'View Record', 'All IDs'];
                  return (
                    <button
                      key={t}
                      className={`ds-topbar-nav-link${tab === t ? ' active' : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {labels[i]}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="ds-topbar-right">
              <HospitalAvatar name={hospitalName} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ds-primary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hospitalName}
              </span>
              <button className="ds-signout-btn" onClick={handleSignOut}>Sign out</button>
            </div>
          </div>
        </header>

        {/* Dashboard content */}
        <div className="ds-content ds-fade-in">

          {/* Hero */}
          <section className="ds-hero">
            <div>
              <h2 className="ds-hero-title">Main Dashboard</h2>
              <p className="ds-hero-sub">Hospital Information Exchange Overview</p>
            </div>
            <div className="ds-hero-actions">
              <button className="ds-btn-outline" onClick={() => setTab('view')}>
                <span className="material-symbols-outlined">visibility</span>
                View Record
              </button>
              <button className="ds-btn-primary" onClick={() => setTab('add')}>
                <span className="material-symbols-outlined">add</span>
                Add Record
              </button>
            </div>
          </section>

          {/* Bento grid */}
          <div className="ds-bento">

            {/* Main card */}
            <div className="ds-bento-main">
              <div className="ds-bento-main-blob" />
              <div className="ds-tab-content">
                {tab === 'add'  && <PatientForm token={token} onRecordAdded={fetchRecentIds} />}
                {tab === 'view' && <RecordViewer token={token} />}
                {tab === 'all'  && <AllPatients token={token} />}
              </div>
            </div>

            {/* Side stack */}
            <div className="ds-bento-side">

              {/* Real blockchain status */}
              <div className="ds-status-card">
                <div className="ds-status-card-overlay" />
                <div className="ds-status-card-inner">
                  <h3 className="ds-status-card-title">
                    <span className="material-symbols-outlined">hub</span>
                    Ledger Network Status
                  </h3>
                  <div className="ds-status-rows">
                    <div className="ds-status-row">
                      <span className="ds-status-row-label">Latest Block</span>
                      <span className="ds-status-row-value">
                        {network ? `#${network.blockNumber.toLocaleString()}` : '—'}
                      </span>
                    </div>
                    <div className="ds-status-row">
                      <span className="ds-status-row-label">Last Block Hash</span>
                      <span className="ds-status-row-mono">
                        {network ? truncateHash(network.lastBlockHash) : '—'}
                      </span>
                    </div>
                    <div className="ds-status-row">
                      <span className="ds-status-row-label">Network</span>
                      <span className="ds-status-row-value" style={{ fontSize: '0.875rem', textTransform: 'capitalize' }}>
                        {network ? network.networkName : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="ds-status-online">
                    <div className="ds-status-dot" />
                    <span className="ds-status-online-text">
                      {network ? 'Network Operational' : 'Connecting...'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Security integrity */}
              <div className="ds-security-card">
                <h3 className="ds-security-title">Security Integrity</h3>
                <div className="ds-security-items">
                  <div className="ds-security-item">
                    <div className="ds-security-icon tertiary">
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    </div>
                    <div>
                      <p className="ds-security-item-title">Immutable Verification</p>
                      <p className="ds-security-item-desc">All records are cryptographically hashed and cannot be altered without consensus.</p>
                    </div>
                  </div>
                  <div className="ds-security-item">
                    <div className="ds-security-icon primary">
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>history</span>
                    </div>
                    <div>
                      <p className="ds-security-item-title">Audit Trail Enabled</p>
                      <p className="ds-security-item-desc">Real-time tracking of data access by authorized medical personnel only.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Full-width: real recent ledger entries */}
            <div className="ds-bento-full">
              <div className="ds-ledger-header">
                <h3 className="ds-ledger-title">Recent Ledger Entries</h3>
                <button className="ds-ledger-link" onClick={() => setTab('all')}>
                  View All Records
                </button>
              </div>
              <div className="ds-ledger-list">
                {recentIds.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ds-on-surface-variant)', fontSize: '0.875rem' }}>
                    No records stored yet. Add a patient record to see it here.
                  </div>
                ) : (
                  recentIds.map((id) => (
                    <div key={id} className="ds-ledger-entry">
                      <div className="ds-ledger-entry-left">
                        <div className="ds-ledger-entry-icon">
                          <span className="material-symbols-outlined">description</span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p className="ds-ledger-entry-name">Patient Record</p>
                          <p className="ds-ledger-entry-desc" style={{ fontFamily: 'Courier New, monospace' }}>{id}</p>
                        </div>
                      </div>
                      <div className="ds-ledger-entry-right">
                        <span className="ds-badge ds-badge-verified">✓ On-Chain</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>

        <footer className="ds-footer">
          <p>© 2026 Clinical Ledger Protocol. All healthcare data is AES-256 encrypted and anchored on the Ethereum blockchain via IPFS. k-Set Byzantine consensus (n=5, f=1) ensures data integrity across nodes.</p>
        </footer>
      </main>
    </div>
  );
}
