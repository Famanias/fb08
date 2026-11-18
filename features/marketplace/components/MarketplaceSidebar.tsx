'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { CATEGORIES } from '../types';

export function MarketplaceSidebar() {
  const pathname = usePathname(); const params = useSearchParams();
  const category = params.get('category') || 'All';
  return <aside className="left-rail" aria-label="Marketplace sidebar">
    <section className="side-block"><h2 className="side-head">Marketplace</h2>
      <Link className={`side-link${pathname === '/marketplace' ? ' active' : ''}`} href="/marketplace"><span>▦ &nbsp; Browse Listings</span></Link>
      <Link className={`side-link${pathname === '/marketplace/new' ? ' active' : ''}`} href="/marketplace/new"><span>＋ &nbsp; Post an Item</span></Link>
      <Link className={`side-link${pathname.startsWith('/marketplace/payments') ? ' active' : ''}`} href="/marketplace/payments">Seller payments</Link>
      <a className="side-link" href="#marketplace-help">How Marketplace works</a>
    </section>
    <section className="side-block"><h2 className="side-head">Categories</h2>{CATEGORIES.map(item => {
      const next = new URLSearchParams(params); next.set('category', item); next.delete('page');
      return <Link className={`side-link${pathname === '/marketplace' && category === item ? ' active' : ''}`} href={'/marketplace?' + next} key={item}>{item}</Link>;
    })}</section>
    <section className="side-block"><h2 className="side-head">A small reminder</h2><p className="side-note">Meet in public places. Inspect items before paying. If a deal feels too good to be true, it might be.</p></section>
    <div className="side-banner"><strong>Remember 2008?</strong>Buying something used from a stranger on the internet was an adventure.</div>
  </aside>;
}
