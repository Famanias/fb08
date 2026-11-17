/** Operator-only: inspection by default; --apply classifies exact verified IDs. */
import { pathToFileURL } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../lib/server/supabase-admin';
import { expectedDemoRows, type DemoExpectation } from './lib/marketplace-demo-fixtures';

type Classification = { classified: string[]; missing: string[] };
export interface DemoDatabase {
  inspect(ids: string[]): Promise<Array<DemoExpectation & { inventoryKind: string }>>;
  apply(expected: DemoExpectation[]): Promise<Classification>;
}
export function demoDatabase(db: SupabaseClient): DemoDatabase {
  return {
    async inspect(ids) {
      const { data, error } = await db.from('marketplace_listings').select('id,title,description,price,category,seller_display_name,image_path,inventory_kind,marketplace_listing_contacts(seller_email)').in('id', ids);
      if (error) throw new Error('Could not inspect demo inventory.');
      return (data ?? []).map(row => {
        const contact = row.marketplace_listing_contacts as unknown as { seller_email: string } | null;
        return { id: row.id, title: row.title, description: row.description, price: Number(row.price).toFixed(2), category: row.category, sellerDisplayName: row.seller_display_name, imagePath: row.image_path, inventoryKind: row.inventory_kind, sellerEmail: contact?.seller_email ?? '' };
      });
    },
    async apply(expected) {
      const { data, error } = await db.rpc('marketplace_classify_demo_inventory', { p_expected: expected });
      if (error) throw new Error('Demo manifest verification failed; no classification was applied.');
      return data as Classification;
    },
  };
}
export async function classifyMarketplaceDemos(db: DemoDatabase, apply = false): Promise<Classification> {
  const expected = expectedDemoRows();
  if (apply) return db.apply(expected);
  const actual = await db.inspect(expected.map(row => row.id));
  for (const row of actual) {
    const match = expected.find(item => item.id === row.id)!;
    if (Object.entries(match).some(([key, value]) => key === 'price' ? Number(row.price) !== Number(value) : row[key as keyof DemoExpectation] !== value)) throw new Error('Demo manifest mismatch; no changes made.');
  }
  return { classified: actual.filter(row => row.inventoryKind === 'demo').map(row => row.id), missing: expected.filter(row => !actual.some(item => item.id === row.id)).map(row => row.id) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  classifyMarketplaceDemos(demoDatabase(getSupabaseAdminClient()), process.argv.includes('--apply'))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Demo classification stopped. Verify the exact manifest and private contacts.'); process.exitCode = 1; });
}
