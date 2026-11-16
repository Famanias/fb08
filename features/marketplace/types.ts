export const CATEGORIES = ['Electronics', 'Furniture', 'Clothing', 'Books', 'Sports', 'Home', 'Other'] as const;
export type MarketplaceCategory = typeof CATEGORIES[number];
export const SORTS = ['newest', 'price_asc', 'price_desc', 'name'] as const;
export const PAGE_SIZE = 18;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export type ListingFilters = { q: string; category: MarketplaceCategory | 'All'; sort: typeof SORTS[number]; page: number };
export type PublicListing = {
  id: string; title: string; description: string; price: number; currency: 'PHP';
  category: MarketplaceCategory; sellerDisplayName: string; imageUrl: string;
  createdAt: string; status: 'active' | 'sold';
};
export type ListingPage = { listings: PublicListing[]; total: number; hasMore: boolean };
export type CreateListingInput = { title: string; description: string; price: string; category: MarketplaceCategory; sellerDisplayName: string; sellerEmail: string };
export type InquiryInput = { listingId: string; buyerName: string; buyerEmail: string; message: string };
export function formatPrice(price: number) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(price); }
