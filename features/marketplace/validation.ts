import { CATEGORIES, SORTS, type CreateListingInput, type InquiryInput, type ListingFilters, type MarketplaceCategory, type PublicListing } from './types';

export class MarketplaceError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message); }
}
export function text(value: unknown, field: string, max: number, optional = false): string {
  if (value == null && optional) return '';
  if (typeof value !== 'string') throw new MarketplaceError(`Enter a valid ${field}.`, 400, field);
  const trimmed = value.trim();
  if ((!optional && !trimmed) || trimmed.length > max) throw new MarketplaceError(`${field} must be ${optional ? 'at most' : '1–'}${max} characters.`, 400, field);
  return trimmed;
}
function email(value: unknown, field: string) {
  const result = text(value, field, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new MarketplaceError('Enter a valid email address.', 400, field);
  return result;
}
export function validUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function validateListing(input: Record<string, unknown>): CreateListingInput {
  const inventoryKind = input.inventoryKind ?? 'ordinary';
  if (inventoryKind !== 'ordinary' && inventoryKind !== 'sandbox') throw new MarketplaceError('Choose a valid inventory kind.', 400, 'inventoryKind');
  if (['paymentTenant', 'payment_tenant', 'tenant', 'owner', 'ownerUserId', 'owner_user_id'].some(key => key in input)) {
    throw new MarketplaceError('Invalid listing details.');
  }
  const price = text(input.price, 'price', 12);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(price)) throw new MarketplaceError('Enter a price from ₱0 to ₱999,999,999.99 with at most two decimals.', 400, 'price');
  if (!CATEGORIES.includes(input.category as MarketplaceCategory)) throw new MarketplaceError('Choose a valid category.', 400, 'category');
  return { title: text(input.title, 'title', 100), description: text(input.description, 'description', 2000), price, category: input.category as MarketplaceCategory, sellerEmail: email(input.sellerEmail, 'sellerEmail'), sellerDisplayName: text(input.sellerDisplayName, 'sellerDisplayName', 50, true) || 'Guest Seller', inventoryKind };
}
export function validateInquiry(input: Record<string, unknown>): InquiryInput {
  if (!validUuid(input.listingId)) throw new MarketplaceError('Listing not found.', 404);
  return { listingId: input.listingId, buyerName: text(input.buyerName, 'buyerName', 50, true), buyerEmail: email(input.buyerEmail, 'buyerEmail'), message: text(input.message, 'message', 1000) };
}
export function parseFilters(params: URLSearchParams): ListingFilters {
  const q = text(params.get('q') ?? '', 'search', 100, true);
  const category = params.get('category') || 'All';
  const sort = params.get('sort') || 'newest';
  const pageValue = params.get('page') || '0';
  if (category !== 'All' && !CATEGORIES.includes(category as MarketplaceCategory)) throw new MarketplaceError('Unknown category.');
  if (!SORTS.includes(sort as typeof SORTS[number])) throw new MarketplaceError('Unknown sort order.');
  if (!/^\d{1,6}$/.test(pageValue) || Number(pageValue) > 100000) throw new MarketplaceError('Invalid page.');
  return { q, category: category as ListingFilters['category'], sort: sort as ListingFilters['sort'], page: Number(pageValue) };
}
export function publicListing(row: Record<string, unknown>, imageUrl: string): PublicListing {
  return { id: String(row.id), title: String(row.title), description: String(row.description), price: Number(row.price), currency: 'PHP', category: row.category as MarketplaceCategory, sellerDisplayName: String(row.seller_display_name), imageUrl, createdAt: String(row.created_at), status: row.status as PublicListing['status'], inventoryKind: (row.inventory_kind ?? 'ordinary') as PublicListing['inventoryKind'], paymentState: { sandbox: row.inventory_kind === 'sandbox', availability: row.status === 'sold' ? 'sold' : 'unavailable' } };
}
