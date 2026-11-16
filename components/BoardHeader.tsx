'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { BoardUser } from '@/features/board/board.types';

interface BoardHeaderProps {
  user: BoardUser | null;
  searchQuery: string;
  activeView: 'board' | 'people' | 'profile' | 'marketplace';
  activeProfileUsername: string | null;
  onSearchChange: (value: string) => void;
  onShowBoard: () => void;
  onShowPeople: () => void;
  onOpenProfile: (username: string) => void;
}

export function BoardHeader({
  user,
  searchQuery,
  activeView,
  activeProfileUsername,
  onSearchChange,
  onShowBoard,
  onShowPeople,
  onOpenProfile,
}: BoardHeaderProps) {
  return (
    <header className="topbar">
      <div className="top-inner">
        <a
          href="#top"
          className="brand"
          aria-label="FB 08 Home"
          onClick={(e) => {
            e.preventDefault();
            onShowBoard();
          }}
        >
          fb<em>/08</em>
          <span className="brand-sub">social</span>
        </a>
        <nav className="top-links" aria-label="Primary">
          <button
            type="button"
            id="nav-board"
            className={`top-link${activeView === 'board' ? ' active' : ''}`}
            onClick={onShowBoard}
          >
            Board
          </button>
          <button
            type="button"
            id="nav-people"
            className={`top-link${activeView === 'people' ? ' active' : ''}`}
            onClick={onShowPeople}
          >
            People
          </button>
          <Link href="/marketplace" className={`top-link${activeView === 'marketplace' ? ' active' : ''}`} aria-current={activeView === 'marketplace' ? 'page' : undefined}>
            Marketplace
          </Link>
          {user ? (
            <button
              type="button"
              id="nav-my-profile"
              className={`top-link${
                activeView === 'profile' &&
                activeProfileUsername?.toLowerCase() === user.username.toLowerCase()
                  ? ' active'
                  : ''
              }`}
              onClick={() => onOpenProfile(user.username)}
            >
              My Profile
            </button>
          ) : null}
        </nav>
        <div className="top-spacer" />
        <span className="signed" id="top-greeting">
          {user ? `Signed in as ${user.username}` : activeView === 'marketplace' ? 'Visitor (Marketplace guest)' : 'Visitor (read-only)'}
        </span>
        {activeView !== 'marketplace' && <label className="top-search" aria-label="Search threads, posts, and people">
          <input
            id="search"
            type="search"
            placeholder="Search board & people"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <span className="search-icon" aria-hidden="true">
            <Search className="svg-icon" strokeWidth={2.3} />
          </span>
        </label>}
      </div>
    </header>
  );
}
