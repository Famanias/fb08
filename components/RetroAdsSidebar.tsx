'use client';

import { MixtapeAdSvg, ScubaAdSvg, WallpaperAdSvg } from './RetroArtwork';

interface RetroAdsSidebarProps {
  postCount: number;
}

export function RetroAdsSidebar({ postCount }: RetroAdsSidebarProps) {
  return (
    <aside
      className="sidebar-right"
      aria-label="Retro advertisements and activity"
    >
      <div className="aside-heading">Advertise</div>

      <div className="ad">
        <div className="ad-title">Scuba Diving Vacations</div>
        <div
          className="ad-art"
          role="img"
          aria-label="Retro underwater illustration"
        >
          <ScubaAdSvg />
        </div>
        <div className="ad-desc">
          Dive or snorkel with unforgettable sea life. The vacation your desktop
          wallpaper deserves!
        </div>
        <div className="ad-reaction">♧ ♡ ◇</div>
      </div>

      <div className="ad">
        <div className="ad-title">Free Desktop Wallpapers!</div>
        <div
          className="ad-art"
          role="img"
          aria-label="Retro landscape desktop wallpaper graphic"
        >
          <WallpaperAdSvg />
        </div>
        <div className="ad-desc">
          Give your computer a fresh look. Available in 1024 × 768!
        </div>
        <div className="ad-reaction">♧ ♡ ◇</div>
      </div>

      <div className="ad">
        <div className="ad-title">Make Your Own Mixtape</div>
        <div className="ad-art" role="img" aria-label="Illustrated cassette tape">
          <MixtapeAdSvg />
        </div>
        <div className="ad-desc">
          The songs you love, in the order you choose. Some things never go out
          of style.
        </div>
        <div className="ad-reaction">♧ ♡ ◇</div>
      </div>

      <div className="aside-heading">Wall Activity</div>
      <div className="right-stat">
        <strong id="right-post-count">{postCount}</strong> notes on the wall
      </div>
      <div className="right-stat">
        The internet is better when you say hello.
      </div>
      <span className="retro-badge">✦ MADE FOR NOSTALGIA</span>
    </aside>
  );
}
