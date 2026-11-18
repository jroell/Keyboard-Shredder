import { useState, type FormEvent } from 'react';
import type { Auth } from 'firebase/auth';

export default function AccountAccess({ auth, invite }: { auth: Auth; invite: boolean }) {
  const [mode, setMode] = useState<'login' | 'create' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const sdk = await import('firebase/auth');
      if (!event) await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      else if (mode === 'login') await sdk.signInWithEmailAndPassword(auth, email.trim(), password);
      else if (mode === 'create') await sdk.createUserWithEmailAndPassword(auth, email.trim(), password);
      else {
        try { await sdk.sendPasswordResetEmail(auth, email.trim()); }
        catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
        setMessage('If this address has an account, check its inbox for a reset link.');
      }
    } catch {
      setMessage(mode === 'create' && event
        ? 'Could not create an account. Check the email or sign in if you already have an account.'
        : 'Could not complete the request. Check your connection and credentials, then try again.');
    } finally {
      setBusy(false);
    }
  }
  const switchTo = (next: typeof mode) => { setMode(next); setPassword(''); setMessage(''); };
  return <section className="panel settings account-panel">
    <h2>{invite ? 'Sign in to join the duel' : mode === 'create' ? 'Create your account' : 'Your account'}</h2>
    <form onSubmit={event => void submit(event)}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      {mode !== 'reset' && <label>Password<input type="password" minLength={6} required
        autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
        value={password} onChange={event => setPassword(event.target.value)} /></label>}
      <button className="primary" disabled={busy}>{busy ? 'Working…' : mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
    </form>
    <div className="account-actions">
      <button disabled={busy} onClick={() => void submit()}>Sign in with Google</button>
      {mode !== 'login' && <button disabled={busy} onClick={() => switchTo('login')}>Use existing account</button>}
      {mode !== 'create' && <button disabled={busy} onClick={() => switchTo('create')}>Create an account</button>}
      {mode === 'login' && <button disabled={busy} onClick={() => switchTo('reset')}>Reset password</button>}
    </div>
    <p role="status">{message}</p>
  </section>;
}
