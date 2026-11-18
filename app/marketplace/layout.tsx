import Link from 'next/link';
import { Suspense } from 'react';
import { Store, Plus, Camera, Disc3 } from 'lucide-react';
import { MarketplaceHeader } from '@/features/marketplace/components/MarketplaceHeader';
import { MarketplaceSidebar } from '@/features/marketplace/components/MarketplaceSidebar';
import './marketplace.css';

export const metadata = { title: 'Marketplace · fb/08', description: 'Buy, sell, and swap something good with your corner of the internet.' };
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <><MarketplaceHeader /><div className="marketplace"><div className="layout">
    <div className="heading-bar"><div><div className="tiny-crumbs"><Link href="/">fb/08</Link> &nbsp;›&nbsp; Community &nbsp;›&nbsp; Marketplace</div>
      <h1 className="page-title"><span className="market-icon"><Store size={24} aria-hidden="true" /></span>Marketplace</h1><p className="page-subtitle">Buy, sell, and swap something good with your corner of the internet.</p></div>
      <Link className="green-btn" href="/marketplace/new"><Plus size={13} aria-hidden="true" />Post a Listing</Link></div>
    <p className="mobile-payments-link"><Link href="/marketplace/payments">Seller payments</Link></p>
    <div className="board-layout"><Suspense><MarketplaceSidebar /></Suspense><main className="main-panel">{children}</main>
      <aside className="right-rail" aria-label="Marketplace information">
        <section className="right-panel"><h3>Community classifieds</h3><p>Seven categories. One corner of the internet.</p><p>Free to post. No account required.</p></section>
        <section className="side-block"><h2 className="side-head">Around the internet</h2><div className="old-ad"><div className="ad-graphic one"><Camera size={48} strokeWidth={1} aria-hidden="true" /></div><strong>Got an old camera?</strong><p>Somebody out there is looking for it.</p></div><div className="old-ad"><div className="ad-graphic two"><Disc3 size={48} strokeWidth={1} aria-hidden="true" /></div><strong>Remember mixtapes?</strong><p>One person’s clutter is another’s treasure.</p></div></section>
      </aside>
    </div><section className="right-panel marketplace-help" id="marketplace-help"><h2>How Marketplace works</h2><p>Browse an item, share something you’ve got, or save a private inquiry for a listing. Contact emails and buyer messages are private. Email notifications are not enabled yet, so a saved inquiry does not guarantee the seller will see it.</p></section>
    <footer className="footer"><span>fb/08 Marketplace · Old-school community classifieds</span><span><Link href="/">Board</Link> · <Link href="/?view=people">People</Link> · <Link href="/marketplace">Marketplace</Link></span></footer>
  </div></div></>;
}
