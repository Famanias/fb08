import { getSupabaseAdminClient } from './supabase-admin';
import { PAGE_SIZE, type CreateListingInput, type InquiryInput, type ListingFilters, type ListingPage, type PublicListing } from '@/features/marketplace/types';
import { MarketplaceError, publicListing } from '@/features/marketplace/validation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPaymentStore } from './marketplace-payments/store';
import { getPaymentConfig } from './marketplace-payments/config';

const BUCKET = 'marketplace-images';
const PUBLIC_COLUMNS = 'id,title,description,price,currency,category,seller_display_name,image_path,status,created_at,inventory_kind';
export type SandboxListingOwner = { tenant: string; userId: string };
export interface MarketplaceStore {
  browse(filters: ListingFilters): Promise<ListingPage>;
  find(id: string): Promise<PublicListing | null>;
  consumeRate(actor: string, action: string, limit: number): Promise<boolean>;
  upload(path: string, bytes: Buffer): Promise<void>;
  cleanup(path: string): Promise<void>;
  publish(key: string, fingerprint: string, id: string, path: string, input: CreateListingInput, owner?: SandboxListingOwner): Promise<string>;
  inquire(key: string, fingerprint: string, input: InquiryInput): Promise<string>;
}
function databaseError(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('request_conflict')) throw new MarketplaceError('This submission key has already been used with different details. Reload to start a new submission.', 409);
  if (error.message.includes('listing_unavailable')) throw new MarketplaceError('This listing is no longer available.', 404);
  throw new MarketplaceError('Marketplace is temporarily unavailable. Please try again.', 503);
}
export function createMarketplaceStore(db: SupabaseClient = getSupabaseAdminClient()): MarketplaceStore {
  const hydrate = (row: Record<string, unknown>) => publicListing(row, db.storage.from(BUCKET).getPublicUrl(String(row.image_path)).data.publicUrl);
  return {
    async browse(filters) {
      const { data, error } = await db.rpc('marketplace_browse', { p_q: filters.q, p_category: filters.category, p_sort: filters.sort, p_page: filters.page });
      databaseError(error);
      if (!data || !Array.isArray(data.listings) || typeof data.total !== 'number') throw new MarketplaceError('Could not load listings. Please try again.', 503);
      const listings: PublicListing[] = data.listings.map(hydrate);
      try {
        const context = getPaymentConfig(process.env);
        const states = await createPaymentStore(db).getPublicPaymentStates(listings.map(item => item.id), context);
        for (const listing of listings) listing.paymentState = states[listing.id] ?? listing.paymentState;
      } catch { /* Missing configuration/cache is unavailable; ordinary browse remains usable. */ }
      return { listings, total: data.total, hasMore: (filters.page + 1) * PAGE_SIZE < data.total };
    },
    async find(id) {
      const { data, error } = await db.from('marketplace_listings').select(PUBLIC_COLUMNS).eq('id', id).in('status', ['active', 'sold']).maybeSingle();
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
    async publish(key, fingerprint, id, path, input, owner) {
      const args = { p_key: key, p_fingerprint: fingerprint, p_id: id, p_image_path: path, p_input: input };
      const { data, error } = owner
        ? await db.rpc('marketplace_publish_owned_sandbox', { ...args, p_tenant: owner.tenant, p_user_id: owner.userId })
        : await db.rpc('marketplace_publish', args);
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
