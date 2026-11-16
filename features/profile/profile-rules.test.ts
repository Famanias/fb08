import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MEDIA_BYTES,
  canShareProfilePost,
  canViewProfilePost,
  groupProfileComments,
  isFriendFromFollows,
  isValidVisibility,
  validateMediaUpload,
  validateProfilePostInput,
} from './profile-rules';
import { ProfilePostComment } from './profile.types';

test('validateMediaUpload enforces 25MB limit and image/video MIME rules', () => {
  assert.equal(MAX_MEDIA_BYTES, 25 * 1024 * 1024);

  const goodAvatar = validateMediaUpload('avatar', 'image/png', 1024 * 500);
  assert.deepEqual(goodAvatar, { valid: true, mediaType: 'image', extension: 'png' });

  const badAvatarVideo = validateMediaUpload('avatar', 'video/mp4', 1024 * 500);
  assert.equal(badAvatarVideo.valid, false);

  const goodPostVideo = validateMediaUpload('post', 'video/mp4', MAX_MEDIA_BYTES);
  assert.deepEqual(goodPostVideo, { valid: true, mediaType: 'video', extension: 'mp4' });

  const tooLarge = validateMediaUpload('post', 'image/jpeg', MAX_MEDIA_BYTES + 1);
  assert.equal(tooLarge.valid, false);

  const emptyFile = validateMediaUpload('post', 'image/jpeg', 0);
  assert.equal(emptyFile.valid, false);
});

test('follow->friend, post visibility, and share eligibility enforce privacy rules', () => {
  assert.equal(isFriendFromFollows(false, false), false);
  assert.equal(isFriendFromFollows(true, false), false);
  assert.equal(isFriendFromFollows(false, true), false);
  assert.equal(isFriendFromFollows(true, true), true);

  // Guest viewer
  assert.equal(canViewProfilePost('public', null, 'u1', false), true);
  assert.equal(canViewProfilePost('friends', null, 'u1', false), false);
  assert.equal(canViewProfilePost('only_me', null, 'u1', false), false);

  // Non-friend viewer
  assert.equal(canViewProfilePost('friends', 'u2', 'u1', false), false);
  assert.equal(canViewProfilePost('only_me', 'u2', 'u1', false), false);

  // Mutual friend viewer
  assert.equal(canViewProfilePost('friends', 'u2', 'u1', true), true);
  assert.equal(canViewProfilePost('only_me', 'u2', 'u1', true), false);

  // Owner always views own posts
  assert.equal(canViewProfilePost('only_me', 'u1', 'u1', false), true);
  assert.equal(canViewProfilePost('friends', 'u1', 'u1', false), true);

  // Sharing only works on public posts
  assert.equal(canShareProfilePost('public'), true);
  assert.equal(canShareProfilePost('friends'), false);
  assert.equal(canShareProfilePost('only_me'), false);
});

test('validateProfilePostInput and groupProfileComments enforce content and 2-level comments', () => {
  assert.equal(isValidVisibility('public'), true);
  assert.equal(isValidVisibility('friends'), true);
  assert.equal(isValidVisibility('only_me'), true);
  assert.equal(isValidVisibility('invalid'), false);

  assert.equal(
    validateProfilePostInput({ body: '   ', visibility: 'public' }).valid,
    false
  );
  assert.equal(
    validateProfilePostInput({
      body: '',
      visibility: 'friends',
      mediaPath: 'u1/post/x.mp4',
      mediaType: 'video',
    }).valid,
    true
  );
  assert.equal(
    validateProfilePostInput({
      body: '',
      visibility: 'only_me',
      sharedPostId: '00000000-0000-0000-0000-000000000001',
    }).valid,
    true
  );

  const comments: ProfilePostComment[] = [
    {
      id: 'c1',
      post_id: 'p1',
      author_username: 'Bob',
      author_avatar_url: null,
      parent_comment_id: null,
      reply_to_comment_id: null,
      body: 'First comment',
      created_at: '2026-11-16T00:00:00.000Z',
      edited_at: null,
      deleted_at: null,
      is_mine: false,
    },
    {
      id: 'r1',
      post_id: 'p1',
      author_username: 'Alice',
      author_avatar_url: null,
      parent_comment_id: 'c1',
      reply_to_comment_id: 'c1',
      body: 'Reply under first',
      created_at: '2026-11-16T00:01:00.000Z',
      edited_at: null,
      deleted_at: null,
      is_mine: true,
    },
  ];

  const grouped = groupProfileComments(comments);
  assert.equal(grouped.commentCount, 1);
  assert.equal(grouped.replyCount, 1);
  assert.equal(grouped.groups[0].comment.id, 'c1');
  assert.equal(grouped.groups[0].replies[0].id, 'r1');
});
