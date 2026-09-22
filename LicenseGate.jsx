import React, { useState, useEffect } from 'react';
import { getSavedKey, validateLicenseKey, CHECKOUT_URL } from './licenseClient.js';

// Wraps the app: members enter their Lemon Squeezy license key once and the
// app unlocks. Wrap your root component with it in main.jsx:
//
//   <LicenseGate appName="Dinner Bell">
//     <GroceryList />
//   </LicenseGate>
export default function LicenseGate({ appName, children }) {
  const [state, setState] = useState('checking'); // checking | locked | open
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = getSavedKey();
      if (saved) {
        const r = await validateLicenseKey(saved);
        if (!cancelled) setState(r.ok ? 'open' : 'locked');
      } else if (!cancelled) {
        setState('locked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await validateLicenseKey(key);
    setBusy(false);
    if (r.ok) setState('open');
    else setError(r.error);
  }

  if (state === 'open') return <>{children}</>;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {state === 'checking' ? (
          <div style={styles.muted}>Checking membership…</div>
        ) : (
          <>
            <div style={styles.kicker}>MATT'S APPS · MEMBERS</div>
            <div style={styles.title}>{appName} is for members</div>
            <p style={styles.body}>
              This app is part of the Matt's Apps all-access membership. Enter the license key from
              your receipt email to unlock it — you only do this once.
            </p>
            <form onSubmit={submit} style={styles.form}>
              <input
                style={styles.input}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <button style={styles.button} disabled={busy} type="submit">
                {busy ? 'Checking…' : 'Unlock app'}
              </button>
            </form>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.muted}>
              No key yet? <a style={styles.link} href={CHECKOUT_URL}>Become a member</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    background: '#1c1e19',
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 380,
    background: '#2b2e27',
    border: '1px solid #454a3d',
    borderRadius: 16,
    padding: 28,
    textAlign: 'center',
    color: '#f2efe6',
  },
  kicker: {
    fontSize: 11,
    letterSpacing: '0.18em',
    color: '#c9a227',
    marginBottom: 10,
    fontWeight: 600,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    lineHeight: 1.55,
    color: '#c9c6ba',
    margin: '0 0 18px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 12,
  },
  input: {
    padding: '12px 14px',
    fontSize: 15,
    borderRadius: 10,
    border: '1px solid #565c4b',
    background: '#22241e',
    color: '#f2efe6',
    outline: 'none',
    textAlign: 'center',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  button: {
    padding: '12px 14px',
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 10,
    border: 'none',
    background: '#c9a227',
    color: '#1c1e19',
    cursor: 'pointer',
  },
  error: {
    fontSize: 13,
    color: '#e08080',
    marginBottom: 12,
    lineHeight: 1.5,
  },
  muted: {
    fontSize: 13,
    color: '#8b9a7d',
  },
  link: {
    color: '#c9a227',
    fontWeight: 600,
  },
};
