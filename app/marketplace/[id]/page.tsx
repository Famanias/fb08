import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createMarketplaceStore } from '@/lib/server/marketplace-store';
import { validUuid } from '@/features/marketplace/validation';
import { formatPrice } from '@/features/marketplace/types';
import { ListingPhoto } from '@/features/marketplace/components/ListingPhoto';
import { MessageSellerForm } from '@/features/marketplace/components/MessageSellerForm';
export const dynamic = 'force-dynamic';
export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validUuid(id)) notFound();
  const listing = await createMarketplaceStore().find(id);
  if (!listing) notFound();
  return <><Link href="/marketplace" className="back-link">← All Marketplace Listings</Link><article className="panel-box"><div className="panel-title"><div><h2>Item Details</h2><p className="field-help">Marketplace › {listing.category}</p></div><span className="soft-badge">AVAILABLE</span></div>
    <div className="panel-content"><div className="detail-top"><div className="detail-image-wrap"><ListingPhoto src={listing.imageUrl} title={listing.title} /></div><div><h2 className="detail-heading">{listing.title}</h2><p className="detail-price">{formatPrice(listing.price)}</p><dl className="detail-info"><dt>Category</dt><dd>{listing.category}</dd><dt>Seller</dt><dd>{listing.sellerDisplayName}</dd><dt>Posted</dt><dd><time dateTime={listing.createdAt}>{new Date(listing.createdAt).toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })} (Philippine time)</time></dd><dt>Availability</dt><dd className="available">● Available</dd></dl></div></div>
    <h3 className="section-subhead">Description</h3><div className="description-body">{listing.description}</div><MessageSellerForm listingId={listing.id} sellerName={listing.sellerDisplayName} /></div>
  </article></>;
}
