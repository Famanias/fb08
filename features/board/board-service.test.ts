import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseBoardService } from './board-service';
import { BoardConnectionStatus } from './board.types';

function createFakeRealtimeClient() {
  const channels: Array<{
    name: string;
    handlers: Array<{ event: string; table: string; cb: (payload: unknown) => void }>;
    subscribeCb?: (status: string) => void;
  }> = [];
  const removedNames: string[] = [];

  const client = {
    channel(name: string) {
      const ch: (typeof channels)[number] = { name, handlers: [] };
      channels.push(ch);
      const builder = {
        on(
          _type: string,
          filter: { event?: string; schema?: string; table?: string },
          cb: (payload: unknown) => void
        ) {
          ch.handlers.push({
            event: filter.event ?? '*',
            table: filter.table ?? '',
            cb,
          });
          return builder;
        },
        subscribe(cb: (status: string) => void) {
          ch.subscribeCb = cb;
          return builder;
        },
      };
      return builder;
    },
    async removeChannel(ch: unknown) {
      const idx = channels.findIndex((c) => c.name === (ch as { name?: string })?.name);
      if (idx >= 0) {
        removedNames.push(channels[idx].name);
      } else {
        removedNames.push('channel');
      }
      return 'ok';
    },
  };

  return { client, channels, removedNames };
}

test('SupabaseBoardService.subscribeToBoard uses unique channels, cleans up for StrictMode, maps status, and ignores malformed payloads', async () => {
  const { client, channels, removedNames } = createFakeRealtimeClient();
  const service = new SupabaseBoardService({
    client: client as never,
  });

  const statuses: BoardConnectionStatus[] = [];
  const events: string[] = [];

  const unsub1 = service.subscribeToBoard(
    {
      onThreadUpsert: (t) => events.push(`thread:upsert:${t.id}`),
      onThreadDelete: (id) => events.push(`thread:del:${id}`),
      onPostUpsert: (p) => events.push(`post:upsert:${p.id}`),
      onEditInsert: (e) => events.push(`edit:ins:${e.id}`),
    },
    (status) => statuses.push(status)
  );
  unsub1();

  const unsub2 = service.subscribeToBoard(
    {
      onThreadUpsert: (t) => events.push(`thread:upsert:${t.id}`),
      onThreadDelete: (id) => events.push(`thread:del:${id}`),
      onPostUpsert: (p) => events.push(`post:upsert:${p.id}`),
      onEditInsert: (e) => events.push(`edit:ins:${e.id}`),
    },
    (status) => statuses.push(status)
  );

  assert.equal(channels.length, 2);
  assert.notEqual(channels[0].name, channels[1].name);
  assert.equal(removedNames.length, 1);

  const ch2 = channels[1];
  ch2.subscribeCb?.('SUBSCRIBED');
  ch2.subscribeCb?.('CHANNEL_ERROR');
  ch2.subscribeCb?.('TIMED_OUT');

  assert.ok(statuses.includes('connecting'));
  assert.ok(statuses.includes('live'));
  assert.ok(statuses.includes('reconnecting'));

  // Valid + malformed payloads
  const threadHandler = ch2.handlers.find((h) => h.table === 'board_threads');
  const postHandler = ch2.handlers.find((h) => h.table === 'board_posts');
  const editHandler = ch2.handlers.find((h) => h.table === 'board_post_edits');

  threadHandler?.cb({
    eventType: 'INSERT',
    new: {
      id: 't1',
      title: 'Hello',
      reply_count: 1,
      created_at: '2026-11-16T00:00:00.000Z',
      bumped_at: '2026-11-16T00:00:00.000Z',
    },
  });
  threadHandler?.cb({ eventType: 'DELETE', old: { id: 't1' } });
  threadHandler?.cb({ eventType: 'INSERT', new: { bad: true } });

  postHandler?.cb({
    eventType: 'INSERT',
    new: {
      id: 'p1',
      thread_id: 't1',
      post_number: 1,
      anon_tag: 'abcdef',
      message: 'Body',
      created_at: '2026-11-16T00:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    },
  });
  postHandler?.cb({ eventType: 'UPDATE', new: { invalid: 123 } });

  editHandler?.cb({
    eventType: 'INSERT',
    new: {
      id: 'e1',
      post_id: 'p1',
      previous_message: 'Old',
      edited_at: '2026-11-16T00:01:00.000Z',
    },
  });
  editHandler?.cb({ eventType: 'INSERT', new: null });

  assert.deepEqual(events, [
    'thread:upsert:t1',
    'thread:del:t1',
    'post:upsert:p1',
    'edit:ins:e1',
  ]);

  unsub2();
  assert.equal(removedNames.length, 2);
});

test('SupabaseBoardService parses server API errors cleanly for 401, 403, and 409 responses', async () => {
  const responses: Array<{ status: number; body: unknown }> = [
    { status: 401, body: { error: 'Sign in to start a new thread.' } },
    { status: 403, body: { error: 'You can only edit your own posts.' } },
    { status: 409, body: { error: 'Deleted posts cannot be edited.' } },
    { status: 403, body: { error: 'Only the thread creator can delete this thread.' } },
  ];

  const fakeFetch: typeof fetch = async () => {
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const service = new SupabaseBoardService({
    client: null,
    fetchImpl: fakeFetch,
  });

  await assert.rejects(() => service.createThread('T', 'M'), /Sign in to start a new thread/);
  await assert.rejects(() => service.editPost('p1', 'M'), /You can only edit your own posts/);
  await assert.rejects(() => service.editPost('p1', 'M'), /Deleted posts cannot be edited/);
  await assert.rejects(() => service.deleteThread('t1'), /Only the thread creator/);
});
