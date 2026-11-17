import { getSupabaseAdminClient } from './supabase-admin';
import { PAGE_SIZE, type CreateListingInput, type InquiryInput, type ListingFilters, type ListingPage, type PublicListing } from '@/features/marketplace/types';
import { MarketplaceError, publicListing } from '@/features/marketplace/validation';

const BUCKET = 'marketplace-images';
const PUBLIC_COLUMNS = 'id,title,description,price,currency,category,seller_display_name,image_path,status,created_at,inventory_kind';
export interface MarketplaceStore {
  browse(filters: ListingFilters): Promise<ListingPage>;
  find(id: string): Promise<PublicListing | null>;
  consumeRate(actor: string, action: string, limit: number): Promise<boolean>;
  upload(path: string, bytes: Buffer): Promise<void>;
  cleanup(path: string): Promise<void>;
  publish(key: string, fingerprint: string, id: string, path: string, input: CreateListingInput, paymentTenant?: string): Promise<string>;
  inquire(key: string, fingerprint: string, input: InquiryInput): Promise<string>;
}
function databaseError(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('request_conflict')) throw new MarketplaceError('This submission key has already been used with different details. Reload to start a new submission.', 409);
  if (error.message.includes('listing_unavailable')) throw new MarketplaceError('This listing is no longer available.', 404);
  throw new MarketplaceError('Marketplace is temporarily unavailable. Please try again.', 503);
}
export function createMarketplaceStore(): MarketplaceStore {
  const db = getSupabaseAdminClient();
  const hydrate = (row: Record<string, unknown>) => publicListing(row, db.storage.from(BUCKET).getPublicUrl(String(row.image_path)).data.publicUrl);
  return {
    async browse(filters) {
      const { data, error } = await db.rpc('marketplace_browse', { p_q: filters.q, p_category: filters.category, p_sort: filters.sort, p_page: filters.page });
      databaseError(error);
      if (!data || !Array.isArray(data.listings) || typeof data.total !== 'number') throw new MarketplaceError('Could not load listings. Please try again.', 503);
      return { listings: data.listings.map(hydrate), total: data.total, hasMore: (filters.page + 1) * PAGE_SIZE < data.total };
    },
    async find(id) {
      const { data, error } = await db.from('marketplace_listings').select(PUBLIC_COLUMNS).eq('id', id).eq('status', 'active').maybeSingle();
      databaseError(error);
      return data ? hydrate(data) : null;
    },
    async consumeRate(actor, action, limit) {
      const { data, error } = await db.rpc('marketplace_consume_rate', { p_actor: actor, p_action: action, p_limit: limit });
      databaseError(error);
      return data === true;
    },
    async upload(path, bytes) {
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/webp', upsert: false, cacheControl: '3600' });
      databaseError(error);
    },
    async cleanup(path) {
      // A failed response can follow a committed transaction. Never delete its photo.
      const { data, error } = await db.from('marketplace_listings').select('id').eq('image_path', path).maybeSingle();
      if (!error && !data) await db.storage.from(BUCKET).remove([path]);
    },
    async publish(key, fingerprint, id, path, input, paymentTenant) {
      const { data, error } = await db.rpc('marketplace_publish', { p_key: key, p_fingerprint: fingerprint, p_id: id, p_image_path: path, p_input: { ...input, ...(paymentTenant === undefined ? {} : { paymentTenant }) } });
      databaseError(error);
      if (typeof data !== 'string') throw new MarketplaceError('Could not confirm publication. Please retry.', 503);
      return data;
    },
    async inquire(key, fingerprint, input) {
      const { data, error } = await db.rpc('marketplace_save_inquiry', { p_key: key, p_fingerprint: fingerprint, p_input: input });
      databaseError(error);
      if (typeof data !== 'string') throw new MarketplaceError('Could not confirm your inquiry. Please retry.', 503);
      return data;
    },
  };
}
