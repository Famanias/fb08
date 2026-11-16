/** Restricted maintenance utility. Dry run by default; --apply removes only
 * unreferenced server-generated photos older than 24 hours. No public endpoint. */
import { createClient } from '@supabase/supabase-js';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const bucket = db.storage.from('marketplace-images');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates: string[] = [];
  // Enumerate before deleting so mutations cannot shift pagination offsets.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await bucket.list('listings', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error('Could not enumerate Marketplace images. Nothing further was removed.');
    for (const file of data ?? []) if (/^[0-9a-f-]{36}\.webp$/.test(file.name) && file.created_at && new Date(file.created_at).getTime() < cutoff) candidates.push('listings/' + file.name);
    if ((data?.length ?? 0) < 100) break;
  }
  let unreferenced = 0;
  for (const path of candidates) {
    const { data, error } = await db.from('marketplace_listings').select('id').eq('image_path', path).maybeSingle();
    if (error) throw new Error('Could not confirm image references. Cleanup stopped.');
    if (data) continue;
    unreferenced++;
    if (apply) { const { error: removeError } = await bucket.remove([path]); if (removeError) throw new Error('Storage cleanup failed. Retry later.'); }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eligibleUnreferencedImages: unreferenced, minimumAgeHours: 24 }));
}
main().catch(() => { console.error('Marketplace image cleanup failed; retry after confirming database and Storage connectivity.'); process.exitCode = 1; });
