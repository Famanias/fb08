'use client';

import { Search } from 'lucide-react';
import { WallTab } from '@/features/wall/post.types';

interface WallHeaderProps {
  activeTab: WallTab;
  displayName: string;
  searchQuery: string;
  onSelectTab: (tab: WallTab) => void;
  onSearchChange: (value: string) => void;
  onBrandClick: () => void;
}

const NAV_ITEMS: ReadonlyArray<{
  tab: WallTab;
  label: string;
  badge?: string;
}> = [
  { tab: 'wall', label: 'Home' },
  { tab: 'info', label: 'Profile' },
  { tab: 'photos', label: 'Friends' },
  { tab: 'notes', label: 'Inbox', badge: '2' },
];

export function WallHeader({
  activeTab,
  displayName,
  searchQuery,
  onSelectTab,
  onSearchChange,
  onBrandClick,
}: WallHeaderProps) {
  return (
    <header className="topbar">
      <div className="top-inner">
        <a
          href="#top"
          className="brand"
          aria-label="FB 08 Home"
          onClick={(e) => {
            e.preventDefault();
            onBrandClick();
          }}
        >
          fb<em>/08</em>
        </a>
        <nav className="top-links" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                className={`top-link${isActive ? ' active' : ''}`}
                onClick={() => onSelectTab(item.tab)}
              >
                {item.label}
                {item.badge ? (
                  <span className="pill-num">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="top-spacer" />
        <span className="signed" id="top-greeting">
          Hello, {displayName}
        </span>
        <label className="top-search" aria-label="Search wall posts">
          <input
            id="search"
            type="search"
            placeholder="Search the Wall"
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
