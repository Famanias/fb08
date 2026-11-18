'use client';

import { FormEvent, useState } from 'react';
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  validatePassword,
  validateUsername,
} from '@/features/board/board-rules';
import { BoardThreadSummary, BoardUser } from '@/features/board/board.types';
import { ProfileDirectoryEntry } from '@/features/profile/profile.types';

interface AccountSidebarProps {
  user: BoardUser | null;
  isAuthLoading: boolean;
  isAuthSubmitting: boolean;
  authError: string | null;
  threads: BoardThreadSummary[];
  selectedThreadId: string | null;
  directory: ProfileDirectoryEntry[];
  activeProfileUsername: string | null;
  onClearAuthError: () => void;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (username: string, password: string) => Promise<boolean>;
  onLogout: () => Promise<void>;
  onSelectThread: (threadId: string) => void;
  onOpenProfile: (username: string) => void;
}

export function AccountSidebar({
  user,
  isAuthLoading,
  isAuthSubmitting,
  authError,
  threads,
  selectedThreadId,
  directory,
  activeProfileUsername,
  onClearAuthError,
  onLogin,
  onRegister,
  onLogout,
  onSelectThread,
  onOpenProfile,
}: AccountSidebarProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const combinedError = localError ?? authError;

  function validateCredentials(): { username: string; password: string } | null {
    const nameCheck = validateUsername(username);
    if (!nameCheck.valid) {
      setLocalError(nameCheck.error ?? 'Invalid username.');
      return null;
    }
    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      setLocalError(passCheck.error ?? 'Invalid password.');
      return null;
    }
    setLocalError(null);
    return { username: nameCheck.value, password };
  }

  async function handleLoginSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isAuthSubmitting) return;
    const creds = validateCredentials();
    if (!creds) return;
    const ok = await onLogin(creds.username, creds.password);
    if (ok) {
      setPassword('');
    }
  }

  async function handleRegisterClick() {
    if (isAuthSubmitting) return;
    const creds = validateCredentials();
    if (!creds) return;
    const ok = await onRegister(creds.username, creds.password);
    if (ok) {
      setPassword('');
    }
  }

  return (
    <aside id="account" className="sidebar-left" aria-label="Account and active threads">
      <div className="board-box">
        <div className="board-box-head">
          <span>Account</span>
          {user ? <span className="mine-badge">Active</span> : null}
        </div>
        <div className="board-box-body">
          {isAuthLoading ? (
            <p className="auth-note" style={{ marginTop: 0 }}>
              Checking session...
            </p>
          ) : user ? (
            <div>
              <div>
                Signed in as <strong id="signed-in-username">{user.username}</strong>
              </div>
              <p className="auth-note">
                Posts show your username by default. Check &ldquo;Post anonymously&rdquo; on any post to hide it behind a per-thread ID.
              </p>
              <div className="auth-actions" style={{ marginTop: 9 }}>
                <button
                  type="button"
                  id="sidebar-my-profile"
                  className="btn-share"
                  onClick={() => onOpenProfile(user.username)}
                >
                  My Profile
                </button>
                <button
                  type="button"
                  id="auth-logout"
                  className="btn-secondary"
                  disabled={isAuthSubmitting}
                  onClick={() => void onLogout()}
                >
                  Log out
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleLoginSubmit(e)} noValidate>
              <div className="auth-field">
                <label htmlFor="auth-username">Username</label>
                <input
                  id="auth-username"
                  type="text"
                  className="auth-input"
                  maxLength={MAX_USERNAME_LENGTH}
                  autoComplete="username"
                  placeholder="Any handle (1-24 chars)"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (localError) setLocalError(null);
                    if (authError) onClearAuthError();
                  }}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  className="auth-input"
                  maxLength={MAX_PASSWORD_LENGTH}
                  autoComplete="current-password"
                  placeholder="Any password (1+ chars)"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (localError) setLocalError(null);
                    if (authError) onClearAuthError();
                  }}
                />
              </div>
              {combinedError ? (
                <div className="inline-alert" id="auth-error" role="alert" style={{ marginBottom: 8 }}>
                  <span>{combinedError}</span>
                </div>
              ) : null}
              <div className="auth-actions">
                <button
                  type="submit"
                  id="auth-login"
                  className="btn-share"
                  disabled={isAuthSubmitting}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  id="auth-register"
                  className="btn-secondary"
                  disabled={isAuthSubmitting}
                  onClick={() => void handleRegisterClick()}
                >
                  Register
                </button>
              </div>
              <p className="auth-note">
                Guests can read everything. Sign in to start threads or post anonymously.
              </p>
            </form>
          )}
        </div>
      </div>

      <div className="board-box">
        <div className="board-box-head">
          <span>Active Threads</span>
          <span>{threads.length}</span>
        </div>
        {threads.length === 0 ? (
          <div className="board-box-body">
            <span style={{ color: '#8692a3' }}>No threads yet.</span>
          </div>
        ) : (
          <ul className="sidebar-thread-list">
            {threads.slice(0, 12).map((thread) => {
              const isActive = selectedThreadId === thread.id;
              return (
                <li key={thread.id} className="sidebar-thread-item">
                  <button
                    type="button"
                    className={`sidebar-thread-btn${isActive ? ' active' : ''}`}
                    onClick={() => onSelectThread(thread.id)}
                  >
                    <span className="sidebar-thread-title">{thread.title}</span>
                    <span className="sidebar-thread-count">({thread.reply_count})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="board-box">
        <div className="board-box-head">
          <span>People</span>
          <span>{directory.length}</span>
        </div>
        {directory.length === 0 ? (
          <div className="board-box-body">
            <span style={{ color: '#8692a3' }}>No profiles yet.</span>
          </div>
        ) : (
          <ul className="sidebar-thread-list">
            {directory.slice(0, 10).map((member) => {
              const isActive =
                activeProfileUsername?.toLowerCase() === member.username.toLowerCase();
              return (
                <li key={member.id} className="sidebar-thread-item">
                  <button
                    type="button"
                    className={`sidebar-thread-btn${isActive ? ' active' : ''}`}
                    onClick={() => onOpenProfile(member.username)}
                  >
                    <span className="sidebar-thread-title">{member.username}</span>
                    <span className="sidebar-thread-count">
                      {member.relationship.isFriend
                        ? 'Friend ✓'
                        : member.relationship.isFollowing
                          ? 'Following'
                          : member.relationship.followsViewer
                            ? 'Follows you'
                            : 'Profile'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
