'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus } from 'lucide-react';
import { CATEGORIES, MAX_PHOTO_BYTES } from '../types';
import { validateListing, MarketplaceError } from '../validation';
import { marketplaceRequest } from '../service';

export function ListingForm() {
  const router = useRouter(); const lock = useRef(false); const requestKey = useRef<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null); const [preview, setPreview] = useState('');
  const [dragging, setDragging] = useState(false); const [pending, setPending] = useState(false);
  const [error, setError] = useState(''); const [errorField, setErrorField] = useState('');
  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview); }; }, [preview]);
  function choose(file: File | undefined) {
    if (!file || lock.current) return;
    requestKey.current = null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > MAX_PHOTO_BYTES) { setError('Choose a JPG, PNG or WebP photo up to 3 MiB.'); setErrorField('photo'); setPhoto(null); setPreview(''); return; }
    setPhoto(file); setPreview(URL.createObjectURL(file)); setError(''); setErrorField('');
  }
  function field(name: string) { return { 'aria-invalid': errorField === name || undefined, 'aria-describedby': errorField === name ? 'listing-error' : undefined }; }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const form = new FormData(event.currentTarget);
    setError(''); setErrorField('');
    try {
      if (!photo) throw new MarketplaceError('Please upload a photo of your item.', 400, 'photo');
      const input = validateListing(Object.fromEntries(form));
      for (const [key, value] of Object.entries(input)) form.set(key, value);
      form.set('photo', photo);
      lock.current = true; setPending(true);
      requestKey.current ??= crypto.randomUUID();
      const result = await marketplaceRequest<{ id: string }>('/api/marketplace/listings', { method: 'POST', headers: { 'idempotency-key': requestKey.current }, body: form });
      router.push('/marketplace/' + result.id); router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not publish. Please try again.');
      if (failure instanceof MarketplaceError) setErrorField(failure.field || '');
      lock.current = false; setPending(false);
    }
  }
  return <><Link className="back-link" href="/marketplace">← Back to Marketplace</Link><div className="panel-box"><div className="panel-title"><div><h2>Post a New Listing</h2><p className="field-help">Have something to sell? Fill out the details below.</p></div><span className="soft-badge">FREE TO POST</span></div><div className="panel-content">
    <form onSubmit={submit} onChange={() => { if (!lock.current) requestKey.current = null; }} noValidate>
      <fieldset disabled={pending}><legend className="sr-only">Listing details</legend>
        <div className="form-row"><label className="field-label" htmlFor="item-photo">Item Photo <span className="required">*</span></label><label className={`upload-box${photo ? ' has-image' : ''}${dragging ? ' dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
          <input id="item-photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label={photo ? 'Replace item photo' : 'Choose item photo'} onChange={event => choose(event.target.files?.[0])} {...field('photo')} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} className="preview" alt="Selected item photo preview" />}
          <span className="upload-hint"><ImagePlus size={37} aria-hidden="true" /><strong>Click to add a photo</strong> or drag an image here<br />JPG, PNG or WebP · Up to 3 MiB</span>
        </label><p className="field-help">{photo ? `${photo.name} · Click the photo to replace it.` : 'Your photo will be uploaded when you publish. Maximum 25 megapixels; no animated images.'}</p></div>
        <div className="form-row"><label className="field-label" htmlFor="item-title">Listing Title <span className="required">*</span></label><input className="field-input" id="item-title" name="title" maxLength={100} placeholder="e.g. Used silver digital camera" required {...field('title')} /></div>
        <div className="form-columns"><div className="form-row"><label className="field-label" htmlFor="item-price">Price (PHP) <span className="required">*</span></label><input className="field-input" id="item-price" name="price" type="number" min="0" max="999999999.99" step="0.01" inputMode="decimal" placeholder="e.g. 2500" required {...field('price')} /></div><div className="form-row"><label className="field-label" htmlFor="item-category">Category <span className="required">*</span></label><select className="field-input" id="item-category" name="category" required defaultValue="" {...field('category')}><option value="" disabled>Choose a category…</option>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></div></div>
        <div className="form-row"><label className="field-label" htmlFor="item-description">Description <span className="required">*</span></label><textarea className="field-input" id="item-description" name="description" rows={5} maxLength={2000} placeholder="Describe the item, its condition, and what’s included…" required {...field('description')} /><p className="field-help">Include honest details about the item’s condition. Keep contact information out of this public description.</p></div>
        <div className="form-columns"><div className="form-row"><label className="field-label" htmlFor="seller-name">Display Name (optional)</label><input className="field-input" id="seller-name" name="sellerDisplayName" maxLength={50} placeholder="Guest Seller" {...field('sellerDisplayName')} /></div><div className="form-row"><label className="field-label" htmlFor="seller-email">Contact Email <span className="required">*</span></label><input className="field-input" id="seller-email" name="sellerEmail" type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" required {...field('sellerEmail')} /><p className="field-help">Kept private. Never shown on your listing.</p></div></div>
        <div className="form-row"><label className="sandbox-option"><input type="checkbox" name="inventoryKind" value="sandbox" /> This is a fictional sandbox listing: no real money or delivery</label><p className="field-help"><Link href="/#account">Sign in to fb/08</Link> to post sandbox listings. Set up Stripe in <Link href="/marketplace/payments">Seller payments</Link>.</p></div>
        <div className="honeypot" aria-hidden="true"><label>Leave this blank<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      </fieldset>
      {error && <div id="listing-error" className="error-box" role="alert">{error}</div>}
      <p className="field-help">Inquiries are saved privately. Email notifications and a seller inbox are not available yet.</p>
      <div className="form-actions"><Link className="secondary-btn" href="/marketplace">Cancel</Link><button className="green-btn" type="submit" disabled={pending}>{pending ? 'Publishing…' : 'Publish Listing'}</button></div>
    </form>
  </div></div></>;
}
