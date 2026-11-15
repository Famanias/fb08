'use client';

import { WallTab } from '@/features/wall/post.types';
import { ProfilePortraitSvg } from './RetroArtwork';

interface ProfileSidebarProps {
  onSelectTab: (tab: WallTab) => void;
  onWriteOnWall: () => void;
  onPoke: () => void;
  onCopyLink: () => void;
}

export function ProfileSidebar({
  onSelectTab,
  onWriteOnWall,
  onPoke,
  onCopyLink,
}: ProfileSidebarProps) {
  return (
    <aside className="sidebar-left" aria-label="Profile and information">
      <div
        className="profile-photo"
        role="img"
        aria-label="Illustrated monochrome photograph of a person wearing headphones at a computer"
      >
        <ProfilePortraitSvg />
        <div className="photo-tag">profile_photo_2008.jpg</div>
      </div>

      <ul className="sidebar-links">
        <li>
          <button type="button" onClick={() => onSelectTab('photos')}>
            View Photos of the Wall (24)
          </button>
        </li>
        <li>
          <button type="button" onClick={() => onSelectTab('info')}>
            View Info
          </button>
        </li>
        <li>
          <button type="button" id="write-wall" onClick={onWriteOnWall}>
            Write on this Wall
          </button>
        </li>
        <li>
          <button type="button" id="poke" onClick={onPoke}>
            Poke the Wall
          </button>
        </li>
        <li>
          <button type="button" id="copy-link" onClick={onCopyLink}>
            Share this Page
          </button>
        </li>
      </ul>

      <section className="side-section">
        <div className="section-heading">Information</div>
        <div className="side-body">
          <span className="side-label">Networks:</span>
          The Internet
          <br />
          Web 2.0 Enthusiasts
          <span className="side-label">Member Since:</span>
          February 2008
          <span className="side-label">Currently:</span>
          Online, probably on dial-up
          <span className="side-label">About:</span>
          A public wall for little thoughts, big nostalgia, and everything in
          between.
        </div>
      </section>

      <section className="side-section">
        <div className="section-heading">
          <span>Mutual Friends</span>
          <button
            type="button"
            className="section-heading-action"
            onClick={() => onSelectTab('photos')}
          >
            See All
          </button>
        </div>
        <div className="side-body">
          <div className="mutual-row" aria-label="Sample friend avatars">
            <span className="tiny-avatar">A</span>
            <span className="tiny-avatar">J</span>
            <span className="tiny-avatar">M</span>
            <span className="tiny-avatar">S</span>
          </div>
          <a
            href="#photos"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('photos');
            }}
          >
            4 friends in common
          </a>
          <br />
          This page is better with company.
        </div>
      </section>
    </aside>
  );
}
