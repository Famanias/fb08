import Link from 'next/link';
export default function NotFound() { return <div className="empty-state"><h2>Listing not found</h2><p>This listing may have been removed or is no longer available.</p><Link className="primary-btn" href="/marketplace">Browse Marketplace</Link></div>; }
