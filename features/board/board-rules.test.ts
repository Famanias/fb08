import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PASSWORD_LENGTH,
  MAX_POST_LENGTH,
  MAX_THREAD_TITLE_LENGTH,
  MAX_USERNAME_LENGTH,
  MAX_VISIBLE_THREADS,
  filterPostsInThread,
  filterThreads,
  formatPostAuthorLabel,
  mergeThreadList,
  runSingleFlight,
  sortAndMergeThreadPosts,
  sortThreadsByBump,
  validateBoardMessage,
  validatePassword,
  validateThreadTitle,
  validateUsername,
} from './board-rules';
import { BoardPost, BoardThreadSummary } from './board.types';

test('validateUsername trims, enforces 1..24 chars, and accepts 1-char names', () => {
  assert.deepEqual(validateUsername('  Alice  '), { valid: true, value: 'Alice' });
  assert.deepEqual(validateUsername('A'), { valid: true, value: 'A' });
  assert.equal(validateUsername('').valid, false);
  assert.equal(validateUsername('   \n ').valid, false);
  assert.equal(validateUsername('x'.repeat(MAX_USERNAME_LENGTH)).valid, true);
  assert.equal(validateUsername('x'.repeat(MAX_USERNAME_LENGTH + 1)).valid, false);
});

test('validatePassword allows any 1..256 char string without special chars or length floor', () => {
  assert.deepEqual(validatePassword('a'), { valid: true });
  assert.deepEqual(validatePassword('1'), { valid: true });
  assert.deepEqual(validatePassword('p'.repeat(MAX_PASSWORD_LENGTH)), { valid: true });
  assert.equal(validatePassword('').valid, false);
  assert.equal(validatePassword('p'.repeat(MAX_PASSWORD_LENGTH + 1)).valid, false);
});

test('validateThreadTitle trims and enforces 1..120 chars', () => {
  assert.deepEqual(validateThreadTitle('  Question?  '), {
    valid: true,
    value: 'Question?',
  });
  assert.equal(validateThreadTitle('  ').valid, false);
  assert.equal(validateThreadTitle('t'.repeat(MAX_THREAD_TITLE_LENGTH)).valid, true);
  assert.equal(validateThreadTitle('t'.repeat(MAX_THREAD_TITLE_LENGTH + 1)).valid, false);
});

test('validateBoardMessage trims and enforces 1..2000 chars', () => {
  assert.deepEqual(validateBoardMessage('  hello  '), { valid: true, value: 'hello' });
  assert.equal(validateBoardMessage('   \t\n  ').valid, false);
  assert.equal(validateBoardMessage('m'.repeat(MAX_POST_LENGTH)).valid, true);
  assert.equal(validateBoardMessage('m'.repeat(MAX_POST_LENGTH + 1)).valid, false);
});

test('sortThreadsByBump sorts descending by bumped_at then id and caps at 50', () => {
  const input: BoardThreadSummary[] = Array.from({ length: 55 }, (_, i) => ({
    id: `t-${String(i).padStart(3, '0')}`,
    title: `Thread ${i}`,
    reply_count: 1,
    created_at: '2026-11-16T00:00:00.000Z',
    bumped_at:
      i === 54
        ? '2026-11-16T02:00:00.000Z'
        : `2026-11-16T00:${String(i).padStart(2, '0')}:00.000Z`,
  }));

  const sorted = sortThreadsByBump(input);
  assert.equal(sorted.length, MAX_VISIBLE_THREADS);
  assert.equal(sorted[0].id, 't-054');
  assert.equal(sorted[1].id, 't-053');
});

test('mergeThreadList deduplicates, keeps newest bump data, and attaches is_mine flags', () => {
  const existing: BoardThreadSummary[] = [
    {
      id: 't1',
      title: 'First',
      reply_count: 1,
      created_at: '2026-11-16T00:00:00.000Z',
      bumped_at: '2026-11-16T00:00:00.000Z',
      op_anon_tag: 'a1b2c3',
      op_preview: 'OP text',
      is_mine: true,
    },
  ];
  const incoming: BoardThreadSummary[] = [
    {
      id: 't1',
      title: 'First',
      reply_count: 2,
      created_at: '2026-11-16T00:00:00.000Z',
      bumped_at: '2026-11-16T01:00:00.000Z',
    },
    {
      id: 't2',
      title: 'Second',
      reply_count: 1,
      created_at: '2026-11-16T00:30:00.000Z',
      bumped_at: '2026-11-16T00:30:00.000Z',
    },
  ];

  const merged = mergeThreadList(existing, incoming, new Set(['t1']));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 't1');
  assert.equal(merged[0].reply_count, 2);
  assert.equal(merged[0].op_anon_tag, 'a1b2c3');
  assert.equal(merged[0].is_mine, true);
  assert.equal(merged[1].is_mine, false);
});

test('sortAndMergeThreadPosts orders ascending by post_number, merges edits descending, and applies is_mine', () => {
  const existing: BoardPost[] = [
    {
      id: 'p2',
      thread_id: 't1',
      post_number: 2,
      anon_tag: 'beef01',
      message: 'Old two',
      created_at: '2026-11-16T00:02:00.000Z',
      edited_at: null,
      deleted_at: null,
      edits: [
        {
          id: 'e1',
          post_id: 'p2',
          previous_message: 'Draft zero',
          edited_at: '2026-11-16T00:03:00.000Z',
        },
      ],
    },
  ];
  const incoming: BoardPost[] = [
    {
      id: 'p2',
      thread_id: 't1',
      post_number: 2,
      anon_tag: 'beef01',
      message: 'Updated two',
      created_at: '2026-11-16T00:02:00.000Z',
      edited_at: '2026-11-16T00:04:00.000Z',
      deleted_at: null,
      edits: [
        {
          id: 'e2',
          post_id: 'p2',
          previous_message: 'Old two',
          edited_at: '2026-11-16T00:04:00.000Z',
        },
      ],
    },
    {
      id: 'p1',
      thread_id: 't1',
      post_number: 1,
      anon_tag: 'cafe99',
      message: 'OP post',
      created_at: '2026-11-16T00:01:00.000Z',
      edited_at: null,
      deleted_at: null,
    },
  ];

  const merged = sortAndMergeThreadPosts(existing, incoming, new Set(['p2']));
  assert.deepEqual(
    merged.map((p) => p.post_number),
    [1, 2]
  );
  assert.equal(merged[0].is_mine, false);
  assert.equal(merged[1].is_mine, true);
  assert.deepEqual(
    merged[1].edits?.map((e) => e.id),
    ['e2', 'e1']
  );
});

test('filterThreads and filterPostsInThread match case-insensitively', () => {
  const threads: BoardThreadSummary[] = [
    {
      id: 't1',
      title: 'Late night ramen',
      reply_count: 3,
      created_at: '2026-11-16T00:00:00.000Z',
      bumped_at: '2026-11-16T00:00:00.000Z',
      op_preview: 'Open till 3am',
      op_anon_tag: 'a4f211',
    },
    {
      id: 't2',
      title: 'MP3 players',
      reply_count: 1,
      created_at: '2026-11-16T00:00:00.000Z',
      bumped_at: '2026-11-16T00:00:00.000Z',
    },
  ];
  assert.deepEqual(
    filterThreads(threads, 'RAMEN').map((t) => t.id),
    ['t1']
  );
  assert.deepEqual(
    filterThreads(threads, '3AM').map((t) => t.id),
    ['t1']
  );

  const posts: BoardPost[] = [
    {
      id: 'p1',
      thread_id: 't1',
      post_number: 1,
      anon_tag: 'a4f211',
      message: 'Looking for spots',
      created_at: '2026-11-16T00:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'p2',
      thread_id: 't1',
      post_number: 2,
      anon_tag: 'bb1234',
      message: 'Try 4th Ave',
      created_at: '2026-11-16T00:01:00.000Z',
      edited_at: null,
      deleted_at: null,
    },
  ];
  assert.deepEqual(
    filterPostsInThread(posts, 'bb1234').map((p) => p.id),
    ['p2']
  );
  assert.deepEqual(
    filterPostsInThread(posts, '#1').map((p) => p.id),
    ['p1']
  );
});

test('runSingleFlight blocks concurrent calls on same lock until in-flight call settles', async () => {
  const lock = { current: false };
  let executions = 0;
  let releaseFirst!: () => void;

  const p1 = runSingleFlight(lock, async () => {
    executions += 1;
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return true;
  });

  const p2 = runSingleFlight(lock, async () => {
    executions += 1;
    return true;
  });

  assert.equal(await p2, undefined);
  assert.equal(executions, 1);

  releaseFirst();
  assert.equal(await p1, true);
  assert.equal(lock.current, false);

  const p3 = runSingleFlight(lock, async () => {
    executions += 1;
    return false;
  });
  assert.equal(await p3, false);
  assert.equal(executions, 2);
});

test('formatPostAuthorLabel prefers display_name when present and falls back to Anonymous tag', () => {
  assert.equal(
    formatPostAuthorLabel({ display_name: 'Alice', anon_tag: '' }),
    'Alice'
  );
  assert.equal(
    formatPostAuthorLabel({ display_name: null, anon_tag: 'a4f211' }),
    'Anonymous #a4f211'
  );
});
