'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Search, Grid2X2, List, Info } from 'lucide-react';
import { CATEGORIES, PAGE_SIZE, formatPrice, type ListingFilters, type ListingPage } from '../types';
import { ListingPhoto } from './ListingPhoto';

export function ListingBrowser({ data, filters }: { data: ListingPage; filters: ListingFilters }) {
  const params = useSearchParams(); const router = useRouter(); const [pending, startTransition] = useTransition();
  const view = params.get('view') === 'list' ? 'list' : 'grid';
  function href(changes: Record<string, string>) {
    const next = new URLSearchParams(params); next.delete('page');
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return '/marketplace?' + next;
  }
  function navigate(changes: Record<string, string>) { startTransition(() => router.push(href(changes), { scroll: false })); }
  return <div aria-busy={pending}>
    <div className="intro-strip"><Info size={15} aria-hidden="true" /><div><strong>Welcome to the fb/08 Marketplace!</strong> Browse the classifieds or list something of your own.</div></div>
    <div className="search-panel"><form className="search-top" onSubmit={event => { event.preventDefault(); navigate({ q: String(new FormData(event.currentTarget).get('q') || '').trim() }); }}>
      <label className="search-field"><Search size={16} aria-hidden="true" /><input key={filters.q} name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="Search listings…" aria-label="Search title, description, category or seller" /></label><button className="primary-btn" type="submit" disabled={pending}>Search</button><button className="secondary-btn" type="button" onClick={() => navigate({ q: '', category: '' })}>Clear</button>
    </form><nav className="category-tabs" aria-label="Filter listing category">{['All', ...CATEGORIES].map(category => <Link key={category} href={href({ category: category === 'All' ? '' : category })} className={`category-tab${filters.category === category ? ' active' : ''}`} aria-current={filters.category === category ? 'true' : undefined} scroll={false}>{category}</Link>)}</nav></div>
    <div className="toolbar"><div className="toolbar-text" role="status">{data.total} {data.total === 1 ? 'listing' : 'listings'} found <span>· {filters.category === 'All' ? 'All categories' : filters.category}{pending ? ' · Loading…' : ''}</span></div><div className="toolbar-right"><label className="sr-only" htmlFor="marketplace-sort">Sort listings</label><select id="marketplace-sort" className="sort-select" value={filters.sort} onChange={event => navigate({ sort: event.target.value })}><option value="newest">Newest first</option><option value="price_asc">Price: Low to High</option><option value="price_desc">Price: High to Low</option><option value="name">Name A–Z</option></select><div className="view-switch" aria-label="Listing display mode"><button type="button" title="Grid view" aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => navigate({ view: 'grid', page: String(filters.page) })}><Grid2X2 size={15} /></button><button type="button" title="List view" aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => navigate({ view: 'list', page: String(filters.page) })}><List size={15} /></button></div></div></div>
    {data.listings.length ? <div className={view === 'grid' ? 'products-grid' : 'products-list'}>{data.listings.map(listing => <article className="product-card" key={listing.id}>
      <Link href={'/marketplace/' + listing.id} className="product-image" aria-label={'View ' + listing.title}><ListingPhoto src={listing.imageUrl} title={listing.title} lazy /></Link>
      <div className="product-info"><Link href={'/marketplace/' + listing.id} className="product-name" title={listing.title}>{listing.title}</Link><div className="product-meta"><span>{listing.category}</span><time dateTime={listing.createdAt}>{new Date(listing.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}</time></div><p className="seller-name">{listing.sellerDisplayName}</p></div><div className="price">{formatPrice(listing.price)}</div>
    </article>)}</div> : <div className="empty-state"><Search size={29} aria-hidden="true" /><h2>No listings found</h2><p>Try a different search or category, or be the first to list something here.</p><Link href="/marketplace/new" className="primary-btn">Post a Listing</Link></div>}
    {(filters.page > 0 || data.hasMore) && <nav className="pagination" aria-label="Listing pages">{filters.page > 0 && <Link className="secondary-btn" href={href({ page: String(filters.page - 1) })}>← Previous</Link>}<span>Page {filters.page + 1} · {filters.page * PAGE_SIZE + (data.listings.length ? 1 : 0)}–{filters.page * PAGE_SIZE + data.listings.length} of {data.total}</span>{data.hasMore && <Link className="primary-btn" href={href({ page: String(filters.page + 1) })}>Next listings →</Link>}</nav>}
  </div>;
}
