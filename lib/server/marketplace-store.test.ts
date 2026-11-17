import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createMarketplaceStore } from './marketplace-store';
test('sold_detail_remains_public_but_unbuyable and removed remains absent', async () => {
  const queries: URL[] = []; let status = 'sold';
  const db = createClient('http://127.0.0.1:54321', 'local-only', { global: { fetch: async input => {
    const url = new URL(String(input)); queries.push(url);
    return Response.json(url.searchParams.get('status')?.includes(status) ? { id: '60000000-0000-4000-8000-000000000001', title: 'Fictional', status, inventory_kind: 'sandbox', price: '100', category: 'Other', image_path: 'fixture.webp' } : null);
  } } });
  const store = createMarketplaceStore(db); const sold = await store.find('60000000-0000-4000-8000-000000000001');
  assert.equal(sold?.status, 'sold'); status = 'removed'; assert.equal(await store.find('60000000-0000-4000-8000-000000000001'), null);
  assert.equal(queries[0].searchParams.get('status'), 'in.(active,sold)'); assert.doesNotMatch(queries[0].searchParams.get('select')!, /email|account|tenant/);
});
