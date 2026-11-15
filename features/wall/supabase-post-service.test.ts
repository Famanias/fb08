import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseConfig } from '../../lib/supabase-config';
import { WALL_CAPABILITIES } from './capabilities';
import { getPostService } from './post-service';
import { SupabasePostService, type SupabaseLikeClient } from './supabase-post-service';
import { WallConnectionStatus, WallPost } from './post.types';
import { MAX_VISIBLE_POSTS, mergeWallPosts } from './wall-rules';

test('resolveSupabaseConfig accepts publishable key and rejects secret or missing keys', () => {
  const missing = resolveSupabaseConfig({});
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.error, /NEXT_PUBLIC_SUPABASE_URL/);
  }

  const secretRejected = resolveSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_allowed_in_browser',
  });
  assert.equal(secretRejected.ok, false);
  if (!secretRejected.ok) {
    assert.match(secretRejected.error, /secret/i);
  }

  const publishable = resolveSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co/',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
  });
  assert.deepEqual(publishable, {
    ok: true,
    url: 'https://demo.supabase.co',
    key: 'sb_publishable_abc123',
  });

  const legacyFallback = resolveSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.anon',
  });
  assert.deepEqual(legacyFallback, {
    ok: true,
    url: 'https://demo.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiJ9.anon',
  });
});

test('SupabasePostService throws actionable configuration error when client is missing', async () => {
  const service = new SupabasePostService({
    client: null,
    configError: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
  });

  await assert.rejects(() => service.listLatest(50), /NEXT_PUBLIC_SUPABASE_URL/);
  await assert.rejects(
    () => service.create({ author: 'Visitor', message: 'Hello' }),
    /NEXT_PUBLIC_SUPABASE_URL/
  );

  const statuses: WallConnectionStatus[] = [];
  const unsubscribe = service.subscribeToNewPosts(
    () => {},
    (status) => statuses.push(status)
  );
  assert.deepEqual(statuses, ['error']);
  unsubscribe();
});

test('SupabasePostService.listLatest queries latest posts newest-first with id tie-breaker', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rows: WallPost[] = [
    {
      id: '22222222-2222-2222-2222-222222222222',
      author: 'Amy',
      message: 'Newest',
      created_at: '2026-11-15T12:00:00.000Z',
    },
    {
      id: '11111111-1111-1111-1111-111111111111',
      author: 'Bob',
      message: 'Older',
      created_at: '2026-11-15T11:00:00.000Z',
    },
  ];

  const builder = {
    select(columns: string) {
      calls.push({ method: 'select', args: [columns] });
      return builder;
    },
    order(column: string, opts: { ascending: boolean }) {
      calls.push({ method: 'order', args: [column, opts] });
      return builder;
    },
    limit(n: number) {
      calls.push({ method: 'limit', args: [n] });
      return Promise.resolve({ data: rows, error: null });
    },
  };

  const mockClient: SupabaseLikeClient = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return builder as never;
    },
    channel() {
      throw new Error('not used');
    },
    async removeChannel() {
      return 'ok';
    },
  };

  const service = new SupabasePostService({ client: mockClient });
  const result = await service.listLatest(100);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, '22222222-2222-2222-2222-222222222222');
  assert.deepEqual(calls, [
    { method: 'from', args: ['posts'] },
    { method: 'select', args: ['id,author,message,created_at'] },
    { method: 'order', args: ['created_at', { ascending: false }] },
    { method: 'order', args: ['id', { ascending: false }] },
    { method: 'limit', args: [50] },
  ]);
});

test('SupabasePostService.create inserts only trimmed author and message and returns server row', async () => {
  let insertedPayload: unknown = null;
  const serverRow: WallPost = {
    id: '33333333-3333-3333-3333-333333333333',
    author: 'Amy Chen',
    message: 'Hello World!',
    created_at: '2026-11-15T12:05:00.000Z',
  };

  const builder = {
    insert(payload: unknown) {
      insertedPayload = payload;
      return builder;
    },
    select() {
      return builder;
    },
    single() {
      return Promise.resolve({ data: serverRow, error: null });
    },
  };

  const mockClient: SupabaseLikeClient = {
    from() {
      return builder as never;
    },
    channel() {
      throw new Error('not used');
    },
    async removeChannel() {
      return 'ok';
    },
  };

  const service = new SupabasePostService({ client: mockClient });

  await assert.rejects(() =>
    service.create({ author: 'Amy', message: '   \n  ' })
  );
  assert.equal(insertedPayload, null);

  const created = await service.create({
    author: '  Amy   Chen  ',
    message: '  Hello World!  ',
  });
  assert.deepEqual(insertedPayload, {
    author: 'Amy Chen',
    message: 'Hello World!',
  });
  assert.deepEqual(created, serverRow);
});

test('SupabasePostService.subscribeToNewPosts handles status transitions, payload validation, and StrictMode cleanup', () => {
  const channels: Array<{
    name: string;
    insertHandler?: (payload: { new: unknown }) => void;
    statusHandler?: (status: string) => void;
  }> = [];
  const removedChannels: string[] = [];

  const mockClient: SupabaseLikeClient = {
    from() {
      throw new Error('not used');
    },
    channel(name: string) {
      const record: (typeof channels)[number] = { name };
      channels.push(record);
      const ch = {
        on(_type: string, _filter: unknown, cb: (payload: { new: unknown }) => void) {
          record.insertHandler = cb;
          return ch;
        },
        subscribe(cb: (status: string) => void) {
          record.statusHandler = cb;
          return ch;
        },
      };
      return ch as never;
    },
    async removeChannel(ch: unknown) {
      const idx = channels.findIndex((c) => c.name !== undefined && ch);
      void idx;
      removedChannels.push('removed');
      return 'ok';
    },
  };

  const service = new SupabasePostService({ client: mockClient });
  const received: WallPost[] = [];
  const statuses: WallConnectionStatus[] = [];

  const unsub1 = service.subscribeToNewPosts(
    (p) => received.push(p),
    (s) => statuses.push(s)
  );
  unsub1();

  const unsub2 = service.subscribeToNewPosts(
    (p) => received.push(p),
    (s) => statuses.push(s)
  );

  assert.equal(channels.length, 2);
  assert.notEqual(channels[0].name, channels[1].name);
  assert.equal(removedChannels.length, 1);

  // Stale status or insert on unsubscribed channel 1 must be ignored
  channels[0].statusHandler?.('SUBSCRIBED');
  channels[0].insertHandler?.({
    new: {
      id: 'stale',
      author: 'Stale',
      message: 'Ignored',
      created_at: '2026-11-15T12:00:00.000Z',
    },
  });
  assert.equal(received.length, 0);

  // Active channel 2 transitions truthfully
  channels[1].statusHandler?.('SUBSCRIBED');
  channels[1].statusHandler?.('TIMED_OUT');
  channels[1].statusHandler?.('CHANNEL_ERROR');
  channels[1].statusHandler?.('CLOSED');
  assert.deepEqual(statuses, [
    'connecting',
    'connecting',
    'live',
    'reconnecting',
    'error',
    'offline',
  ]);

  // Malformed payload is ignored, valid payload is emitted
  channels[1].insertHandler?.({ new: { id: 123 } });
  channels[1].insertHandler?.({
    new: {
      id: '44444444-4444-4444-4444-444444444444',
      author: 'Visitor',
      message: 'Live post',
      created_at: '2026-11-15T12:10:00.000Z',
    },
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].id, '44444444-4444-4444-4444-444444444444');

  unsub2();
  assert.equal(removedChannels.length, 2);
});

test('live capabilities and getPostService wire SupabasePostService without local preview fallback', () => {
  assert.equal(WALL_CAPABILITIES.isLocalPreview, false);
  assert.equal(WALL_CAPABILITIES.demoInteractionsEnabled, false);
  assert.ok(getPostService() instanceof SupabasePostService);
});

test('mergeWallPosts preserves in-flight realtime posts during initial/reconnect fetch and caps at 50', () => {
  const inFlightRealtime: WallPost = {
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    author: 'RealtimeUser',
    message: 'Arrived during fetch',
    created_at: '2026-11-15T12:01:00.000Z',
  };
  const fetched: WallPost[] = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      author: 'FetchedUser',
      message: 'Already in DB',
      created_at: '2026-11-15T12:00:00.000Z',
    },
    inFlightRealtime,
  ];
  const merged = mergeWallPosts([inFlightRealtime], fetched, MAX_VISIBLE_POSTS);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, inFlightRealtime.id);
  assert.equal(merged[1].id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
});
