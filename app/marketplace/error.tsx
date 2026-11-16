'use client';
export default function MarketplaceError({ reset }: { reset: () => void }) { return <div className="empty-state" role="alert"><h2>Marketplace is temporarily unavailable</h2><p>Your connection may have been interrupted. Please try again.</p><button className="primary-btn" onClick={reset}>Try again</button></div>; }
