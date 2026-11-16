'use client';
import { useRef, useState } from 'react';
import { validateInquiry } from '../validation';
import { marketplaceRequest } from '../service';

export function MessageSellerForm({ listingId, sellerName }: { listingId: string; sellerName: string }) {
  const emailRef = useRef<HTMLInputElement>(null); const lock = useRef(false); const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    try {
      const input = validateInquiry({ ...raw, listingId, message });
      lock.current = true; setPending(true); key.current ??= crypto.randomUUID();
      await marketplaceRequest('/api/marketplace/inquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key.current }, body: JSON.stringify({ ...input, website: raw.website }) });
      setSuccess(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your inquiry. Please try again.'); }
    finally { setPending(false); lock.current = false; }
  }
  return <><button className="primary-btn" type="button" onClick={() => { document.getElementById('message-section')?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); emailRef.current?.focus({ preventScroll: true }); }}>Message Seller</button>
    <section className="message-section" id="message-section"><h3>Send a message to {sellerName}</h3><p>Your inquiry is saved privately for this listing. Email notifications are not enabled yet; saving does not guarantee the seller will see it.</p>
      {success ? <div className="success-box" role="status"><strong>Your message has been saved.</strong><br />Your inquiry is saved for this listing. Email notifications are not enabled yet.</div> : <form onSubmit={submit} onChange={() => { if (!lock.current) key.current = null; }} noValidate>
        <fieldset disabled={pending}><legend className="sr-only">Buyer inquiry</legend><div className="form-columns"><div className="form-row"><label className="field-label" htmlFor="buyer-name">Your Name (optional)</label><input className="field-input" id="buyer-name" name="buyerName" maxLength={50} autoComplete="name" /></div><div className="form-row"><label className="field-label" htmlFor="buyer-email">Your Email <span className="required">*</span></label><input className="field-input" id="buyer-email" name="buyerEmail" type="email" ref={emailRef} maxLength={254} autoComplete="email" required /></div></div>
        <div className="form-row"><label className="field-label" htmlFor="buyer-message">Message <span className="required">*</span></label><textarea className="field-input" id="buyer-message" name="message" rows={4} maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Hi! Is this still available?" required aria-describedby="message-count" /><p className="field-help" id="message-count">{message.length} / 1000 characters</p></div><div className="honeypot" aria-hidden="true"><label>Leave this blank<input name="website" tabIndex={-1} autoComplete="off" /></label></div></fieldset>
        {error && <div className="error-box" role="alert">{error}</div>}<div className="message-actions"><button className="primary-btn" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Send Message'}</button></div>
      </form>}
    </section></>;
}
