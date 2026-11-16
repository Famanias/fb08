import Link from 'next/link';
import { ListingBrowser } from '@/features/marketplace/components/ListingBrowser';
import { MarketplaceError, parseFilters } from '@/features/marketplace/validation';
import { createMarketplaceStore } from '@/lib/server/marketplace-store';
export const dynamic = 'force-dynamic';
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams; const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') params.set(key, value);
  let filters;
  try { filters = parseFilters(params); } catch (error) { return <div className="error-box" role="alert">{error instanceof MarketplaceError ? error.message : 'Invalid filters.'} <Link href="/marketplace">Reset filters</Link></div>; }
  const data = await createMarketplaceStore().browse(filters);
  return <ListingBrowser data={data} filters={filters} />;
}
