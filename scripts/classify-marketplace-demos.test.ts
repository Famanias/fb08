import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarketplaceDemos, type DemoDatabase } from './classify-marketplace-demos';
import { expectedDemoRows } from './lib/marketplace-demo-fixtures';

function fixture() {
  const rows = expectedDemoRows().map(row => ({ ...row, inventoryKind: 'ordinary' }));
  rows.push({ ...rows[0], id: 'f0000000-0000-4000-8000-000000000001', title: '[Demo] Forged title', inventoryKind: 'ordinary' });
  let calls = 0;
  const db: DemoDatabase = {
    async inspect(ids) { return rows.filter(row => ids.includes(row.id)); },
    async apply(expected) {
      calls++;
      // The fake models the atomic full-field database contract.
      for (const row of expected) {
        const actual = rows.find(item => item.id === row.id);
        if (actual && Object.entries(row).some(([key, value]) => actual[key as keyof typeof actual] !== value)) throw new Error('demo_manifest_mismatch');
      }
      const found = rows.filter(row => expected.some(item => item.id === row.id));
      for (const row of found) row.inventoryKind = 'demo';
      return { classified: found.map(row => row.id), missing: expected.filter(row => !found.some(item => item.id === row.id)).map(row => row.id) };
    },
  };
  return { db, rows, calls: () => calls };
}
test('default inspection changes nothing; forged Demo title is never selected', async () => {
  const f = fixture(); await classifyMarketplaceDemos(f.db);
  assert.equal(f.calls(), 0); assert.ok(f.rows.every(row => row.inventoryKind === 'ordinary'));
});
test('apply uses one atomic exact-manifest call, reports missing, and is repeatable', async () => {
  const f = fixture(); const missing = f.rows.splice(2, 1)[0]; const contacts = f.rows.map(row => row.sellerEmail);
  const first = await classifyMarketplaceDemos(f.db, true);
  assert.deepEqual(first.missing, [missing.id]); assert.equal(f.calls(), 1);
  assert.equal(f.rows.at(-1)?.inventoryKind, 'ordinary');
  assert.deepEqual(await classifyMarketplaceDemos(f.db, true), first);
  assert.deepEqual(f.rows.map(row => row.sellerEmail), contacts);
});
test('a single changed manifest row aborts every classification', async () => {
  const f = fixture(); f.rows[1].description += ' altered';
  await assert.rejects(classifyMarketplaceDemos(f.db, true), /manifest/);
  assert.ok(f.rows.every(row => row.inventoryKind === 'ordinary'));
});
