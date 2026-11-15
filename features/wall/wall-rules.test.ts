import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POST_LENGTH,
  MAX_VISIBLE_POSTS,
  appendFeeling,
  filterPosts,
  getStatusLabel,
  normalizeDisplayName,
  prependUniquePost,
  sortAndLimitPosts,
  validatePostMessage,
} from './wall-rules';
import { LocalPostService } from './local-post-service';
import { WallPost } from './post.types';
import { getAvatarColors, getInitials } from '../../lib/initials';
import { formatWallTimestamp } from '../../lib/format-date';
import { StorageAdapter } from '../../lib/safe-storage';

function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('validatePostMessage rejects empty and whitespace-only strings', () => {
  assert.equal(validatePostMessage('').valid, false);
  assert.equal(validatePostMessage('   \n\t  ').valid, false);
});

test('validatePostMessage accepts 1..280 characters and rejects 281+', () => {
  const exact280 = 'a'.repeat(MAX_POST_LENGTH);
  const over280 = 'a'.repeat(MAX_POST_LENGTH + 1);
  const valid = validatePostMessage(`  ${'x'.repeat(10)}  `);
  assert.equal(valid.valid, true);
  assert.equal(valid.trimmed, 'x'.repeat(10));
  assert.equal(validatePostMessage(exact280).valid, true);
  assert.equal(validatePostMessage(over280).valid, false);
});

test('normalizeDisplayName trims, collapses spaces, and caps at 24 chars', () => {
  assert.equal(normalizeDisplayName('   '), null);
  assert.equal(normalizeDisplayName('  Amy   Chen  '), 'Amy Chen');
  assert.equal(
    normalizeDisplayName('ABCDEFGHIJKLMNOPQRSTUVWXYZ999'),
    'ABCDEFGHIJKLMNOPQRSTUVWX'
  );
});

test('sortAndLimitPosts orders newest-first with id tie-breaker, deduplicates, and caps at 50', () => {
  const baseMs = Date.parse('2026-01-01T12:00:00.000Z');
  const posts: WallPost[] = [];
  for (let i = 0; i < 60; i += 1) {
    posts.push({
      id: `p-${String(i).padStart(2, '0')}`,
      author: 'Tester',
      message: `Post ${i}`,
      created_at: new Date(baseMs + i * 1000).toISOString(),
    });
  }
  // Add duplicate ID and same-timestamp tie-breaker
  posts.push({
    id: 'p-59',
    author: 'Tester',
    message: 'Post 59 duplicate',
    created_at: new Date(baseMs + 59 * 1000).toISOString(),
  });
  posts.push({
    id: 'z-tie',
    author: 'Tie',
    message: 'Tie Z',
    created_at: new Date(baseMs + 59 * 1000).toISOString(),
  });

  const sorted = sortAndLimitPosts(posts, MAX_VISIBLE_POSTS);
  assert.equal(sorted.length, 50);
  assert.equal(sorted[0].id, 'z-tie');
  assert.equal(sorted[1].id, 'p-59');
});

test('prependUniquePost avoids duplicates when realtime echoes newly created post', () => {
  const existing: WallPost[] = [
    {
      id: '1',
      author: 'Amy',
      message: 'First',
      created_at: '2026-01-01T10:00:00.000Z',
    },
  ];
  const created: WallPost = {
    id: '2',
    author: 'Visitor',
    message: 'Second',
    created_at: '2026-01-01T11:00:00.000Z',
  };
  const once = prependUniquePost(existing, created);
  const twice = prependUniquePost(once, created);
  assert.equal(twice.length, 2);
  assert.equal(twice[0].id, '2');
});

test('filterPosts matches author or message case-insensitively', () => {
  const list: WallPost[] = [
    { id: '1', author: 'Amy Chen', message: 'Winamp rules', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', author: 'Jordan', message: 'Top friends!', created_at: '2026-01-01T00:00:00Z' },
  ];
  assert.equal(filterPosts(list, 'amy').length, 1);
  assert.equal(filterPosts(list, 'WINAMP').length, 1);
  assert.equal(filterPosts(list, 'missing').length, 0);
});

test('appendFeeling respects 280 character limit', () => {
  assert.deepEqual(appendFeeling('Hello'), { next: 'Hello :)', added: true });
  assert.deepEqual(appendFeeling('Hello '), { next: 'Hello :)', added: true });
  const nearLimit = 'a'.repeat(279);
  assert.deepEqual(appendFeeling(nearLimit), { next: nearLimit, added: false });
});

test('getInitials and getAvatarColors handle names deterministically', () => {
  assert.equal(getInitials('Amy Chen'), 'AC');
  assert.equal(getInitials('Visitor'), 'V');
  assert.equal(getInitials('  '), '?');
  assert.deepEqual(getAvatarColors('Amy Chen'), getAvatarColors('Amy Chen'));
});

test('formatWallTimestamp formats relative ages cleanly', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  assert.equal(formatWallTimestamp(new Date(now - 20_000).toISOString(), now), 'Just now');
  assert.equal(
    formatWallTimestamp(new Date(now - 5 * 60_000).toISOString(), now),
    '5 minutes ago'
  );
});

test('getStatusLabel never labels preview as Live', () => {
  assert.equal(getStatusLabel('preview'), 'Local preview');
  assert.equal(getStatusLabel('live'), 'Live');
});

test('LocalPostService seeds once, persists created posts, and throws when storage fails', async () => {
  const storage = createMemoryStorage();
  const service = new LocalPostService('test.posts', () => storage);

  const initial = await service.listLatest(50);
  assert.equal(initial.length, 4);
  assert.equal(initial[0].id, 'sample-1');

  const created = await service.create({ author: 'Retro Fan', message: 'Hello 2008!' });
  assert.equal(created.author, 'Retro Fan');
  assert.equal(created.message, 'Hello 2008!');
  assert.ok(Date.parse(created.created_at) > 0);

  const afterCreate = await service.listLatest(50);
  assert.equal(afterCreate.length, 5);
  assert.equal(afterCreate[0].id, created.id);

  // Blocked storage fails cleanly without silently losing input
  const brokenStorage: StorageAdapter = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const brokenService = new LocalPostService('test.posts', () => brokenStorage);
  await assert.rejects(() =>
    brokenService.create({ author: 'Visitor', message: 'Should fail' })
  );
});
