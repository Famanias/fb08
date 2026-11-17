'use client';
import { useEffect, useRef, useState } from 'react';
import { paymentRequest } from '../payments/service';
import { SANDBOX_NOTICE, sellerConnectionCopy } from '../payments/presentation';
type SellerStatus = { verified: boolean; connection: string };
export function SellerPaymentsPanel({ mode = 'manage', initial }: { mode?: 'manage' | 'return' | 'refresh'; initial?: SellerStatus }) {
  const [status, setStatus] = useState<SellerStatus | null>(initial ?? null); const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const lock = useRef(false);
  useEffect(() => { if (initial) return; let active = true; paymentRequest<SellerStatus>('/api/marketplace/payments/seller/status').then(value => { if (active) setStatus(value); }).catch(() => { if (active) { setStatus({ verified: false, connection: 'not_connected' }); setError('Could not check seller verification. You can try again below.'); } }); return () => { active = false; }; }, [initial]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setPending(true); setError('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not complete this request. Please retry.'); } finally { lock.current = false; setPending(false); }
  }
  async function checkStatus() { const value = await paymentRequest<SellerStatus>('/api/marketplace/payments/seller/status'); setStatus(value); if (!value.verified) { setCode(''); setChallenge(''); setMessage('Your verification has expired. Verify your email again.'); } }
  return <div className="panel-box"><div className="panel-title"><h2>Seller payments</h2><span className="soft-badge">SANDBOX</span></div><div className="panel-content">
    <p className="payment-notice">{SANDBOX_NOTICE}</p><p>Use the private contact email on your sandbox listings. Verification lasts one hour in this browser.</p>
    {mode === 'return' && <p>Returning from Stripe does not confirm readiness. Check the current connection status below.</p>}
    {mode === 'refresh' && <p>The hosted link may have expired. Verify in this browser, then request a new link below.</p>}
    {!status ? <p role="status">Checking seller verification…</p> : !status.verified ? <form onSubmit={event => { event.preventDefault(); void run(async () => {
      if (challenge) { await paymentRequest('/api/marketplace/payments/seller/verify', { challengeId: challenge, code }); setCode(''); setEmail(''); setChallenge(''); setMessage('Email verified.'); await checkStatus(); }
      else { const value = await paymentRequest<{ challengeId: string; message: string }>('/api/marketplace/payments/seller/challenge', { email }); setChallenge(value.challengeId); setCode(''); setMessage(`${value.message} Codes expire in 10 minutes and allow up to five attempts.`); }
    }); }}><fieldset disabled={pending}><legend className="sr-only">Verify seller email</legend><div className="form-row"><label className="field-label" htmlFor="payment-email">Private listing email</label><input className="field-input" id="payment-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setChallenge(''); setCode(''); }} required /></div>
      {challenge && <div className="form-row"><label className="field-label" htmlFor="payment-code">Six-digit email code</label><input className="field-input payment-code" id="payment-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required aria-describedby="seller-feedback" /></div>}
      <div className="payment-actions"><button className="primary-btn" type="submit">{pending ? 'Please wait…' : challenge ? 'Verify code' : 'Send verification code'}</button>{challenge && <button className="secondary-btn" type="button" onClick={() => { setChallenge(''); setCode(''); setMessage('Request a fresh code. Earlier codes will no longer work.'); }}>Request another code</button>}</div></fieldset></form> : <>
      <p role="status"><strong>{sellerConnectionCopy(status.connection)}</strong></p><div className="payment-actions"><button className="primary-btn" type="button" disabled={pending} onClick={() => void run(async () => { const path = mode === 'refresh' ? 'connect/refresh' : 'connect'; const value = await paymentRequest<{ url: string }>(`/api/marketplace/payments/${path}`, {}); window.location.assign(value.url); })}>{pending ? 'Please wait…' : mode === 'refresh' ? 'Request new Stripe link' : status.connection === 'not_connected' ? 'Connect with Stripe' : 'Continue Stripe onboarding'}</button>
      <button className="secondary-btn" type="button" disabled={pending} onClick={() => void run(checkStatus)}>Check status</button><button className="secondary-btn" type="button" disabled={pending} onClick={() => void run(async () => { await paymentRequest('/api/marketplace/payments/seller/logout', {}); setStatus({ verified: false, connection: 'not_connected' }); setMessage('Seller verification cleared from this browser.'); })}>Log out of seller payments</button></div></>}
    <p id="seller-feedback" role="status" aria-live="polite">{message}</p>{error && <p className="error-box" role="alert">{error}</p>}
    <p className="field-help">This verifies payment ownership only. Board and People use their existing sign-in. Use fictional test details in Stripe onboarding.</p>
  </div></div>;
}
