'use client';

import { Search } from 'lucide-react';
import { BoardUser } from '@/features/board/board.types';

interface BoardHeaderProps {
  user: BoardUser | null;
  searchQuery: string;
  selectedThreadId: string | null;
  onSearchChange: (value: string) => void;
  onShowIndex: () => void;
}

export function BoardHeader({
  user,
  searchQuery,
  selectedThreadId,
  onSearchChange,
  onShowIndex,
}: BoardHeaderProps) {
  return (
    <header className="topbar">
      <div className="top-inner">
        <a
          href="#top"
          className="brand"
          aria-label="FB 08 Textboard Home"
          onClick={(e) => {
            e.preventDefault();
            onShowIndex();
          }}
        >
          fb<em>/08</em>
          <span className="brand-sub">textboard</span>
        </a>
        <nav className="top-links" aria-label="Primary">
          <button
            type="button"
            className={`top-link${selectedThreadId === null ? ' active' : ''}`}
            onClick={onShowIndex}
          >
            All Threads
          </button>
        </nav>
        <div className="top-spacer" />
        <span className="signed" id="top-greeting">
          {user ? `Signed in as ${user.username}` : 'Visitor (read-only)'}
        </span>
        <label className="top-search" aria-label="Search threads and posts">
          <input
            id="search"
            type="search"
            placeholder="Search threads & posts"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <span className="search-icon" aria-hidden="true">
            <Search className="svg-icon" strokeWidth={2.3} />
          </span>
        </label>
      </div>
    </header>
  );
}
