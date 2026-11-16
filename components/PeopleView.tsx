'use client';

import { Users } from 'lucide-react';
import { BoardUser } from '@/features/board/board.types';
import { ProfileDirectoryEntry } from '@/features/profile/profile.types';
import { getAvatarColors, getInitials } from '@/lib/initials';

interface PeopleViewProps {
  profiles: ProfileDirectoryEntry[];
  viewer: BoardUser | null;
  searchQuery: string;
  isLoading: boolean;
  isSubmitting: boolean;
  onOpenProfile: (username: string) => void;
  onToggleFollow: (username: string, follow: boolean) => Promise<boolean>;
}

export function PeopleView({
  profiles,
  viewer,
  searchQuery,
  isLoading,
  isSubmitting,
  onOpenProfile,
  onToggleFollow,
}: PeopleViewProps) {
  const term = searchQuery.trim().toLowerCase();
  const filtered = term
    ? profiles.filter((p) => p.username.toLowerCase().includes(term))
    : profiles;

  return (
    <section aria-label="Member directory">
      <div className="feed-toolbar">
        <span className="feed-heading">
          People Directory · {filtered.length}{' '}
          {filtered.length === 1 ? 'Member' : 'Members'}
        </span>
      </div>

      <div className="feed">
        {isLoading && filtered.length === 0 ? (
          <div className="empty">
            <strong>Loading members...</strong>
            Finding registered profiles.
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <strong>No matching members</strong>
            {term
              ? 'Try clearing or changing your search keyword.'
              : 'Register an account on the left to create the first profile.'}
          </div>
        ) : (
          filtered.map((member) => {
            const [bg, fg] = getAvatarColors(member.username);
            const isSelf = Boolean(viewer && viewer.id === member.id);
            return (
              <article
                key={member.id}
                className="people-row"
                data-member-username={member.username}
              >
                {member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatarUrl}
                    alt={`${member.username} avatar`}
                    className="profile-thumb"
                    style={{ width: 44, height: 44 }}
                  />
                ) : (
                  <div
                    className="post-avatar"
                    style={{ background: bg, color: fg, width: 44, height: 44 }}
                    aria-hidden="true"
                  >
                    {getInitials(member.username)}
                  </div>
                )}

                <div className="people-row-info">
                  <div className="post-line">
                    <button
                      type="button"
                      className="author-profile-link"
                      onClick={() => onOpenProfile(member.username)}
                    >
                      {member.username}
                    </button>
                    {isSelf ? (
                      <span className="mine-badge">You</span>
                    ) : member.relationship.isFriend ? (
                      <span className="friend-badge">
                        <Users className="svg-icon" style={{ marginRight: 3 }} />
                        Friends ✓
                      </span>
                    ) : member.relationship.followsViewer ? (
                      <span className="follow-hint-badge">Follows you</span>
                    ) : member.relationship.isFollowing ? (
                      <span className="follow-hint-badge">Following</span>
                    ) : null}
                  </div>
                  <div className="thread-meta" style={{ marginTop: 3 }}>
                    <span>
                      {member.friendCount}{' '}
                      {member.friendCount === 1 ? 'friend' : 'friends'}
                    </span>
                    <span>
                      {member.followerCount}{' '}
                      {member.followerCount === 1 ? 'follower' : 'followers'}
                    </span>
                  </div>
                </div>

                <div className="people-row-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenProfile(member.username)}
                  >
                    View Profile
                  </button>
                  {viewer && !isSelf ? (
                    <button
                      type="button"
                      className={
                        member.relationship.isFollowing ? 'small-btn' : 'btn-share'
                      }
                      disabled={isSubmitting}
                      onClick={() =>
                        void onToggleFollow(
                          member.username,
                          !member.relationship.isFollowing
                        )
                      }
                    >
                      {member.relationship.isFollowing
                        ? 'Unfollow'
                        : member.relationship.followsViewer
                          ? 'Follow Back'
                          : 'Follow'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
