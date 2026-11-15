'use client';

import { WallTab } from '@/features/wall/post.types';

interface WallTabsProps {
  activeTab: WallTab;
  onSelectTab: (tab: WallTab) => void;
}

const TABS: ReadonlyArray<{ id: WallTab; label: string }> = [
  { id: 'wall', label: 'Wall' },
  { id: 'info', label: 'Info' },
  { id: 'photos', label: 'Photos' },
  { id: 'notes', label: 'Notes' },
  { id: 'boxes', label: 'Boxes' },
];

export function WallTabs({ activeTab, onSelectTab }: WallTabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label="Wall sections">
      {TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            className={`tab${selected ? ' active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
