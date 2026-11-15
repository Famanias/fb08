'use client';

import { WallTab } from '@/features/wall/post.types';

interface StaticTabContentProps {
  activeTab: Exclude<WallTab, 'wall'>;
  postCount: number;
  onGoToWall: () => void;
}

export function StaticTabContent({
  activeTab,
  postCount,
  onGoToWall,
}: StaticTabContentProps) {
  if (activeTab === 'info') {
    return (
      <section
        className="tab-content sub-page"
        id="panel-info"
        role="tabpanel"
        aria-labelledby="tab-info"
      >
        <h2>Basic Information</h2>
        <div className="info-row">
          <span className="info-key">Name</span>
          <span>FB/08 Community</span>
        </div>
        <div className="info-row">
          <span className="info-key">Founded</span>
          <span>2008 (at least in spirit)</span>
        </div>
        <div className="info-row">
          <span className="info-key">Website</span>
          <span>This little piece of the internet</span>
        </div>
        <div className="info-row">
          <span className="info-key">Favorite Things</span>
          <span>
            Status updates, photo albums, pokes, compact navigation, and blue
            hyperlinks.
          </span>
        </div>
        <div className="info-row">
          <span className="info-key">What is this?</span>
          <span>
            A nostalgic frontend prototype inspired by the era of social walls.
            Posts are stored in this browser as a local preview for now;
            Supabase integration comes next.
          </span>
        </div>

        <h2 style={{ marginTop: '23px' }}>Personal Information</h2>
        <p style={{ fontSize: '11px', color: '#5c6573', maxWidth: '460px' }}>
          No account needed. Pick any display name, leave a note, and enjoy the
          early-web atmosphere. Your name is not verified.
        </p>
      </section>
    );
  }

  if (activeTab === 'photos') {
    return (
      <section
        className="tab-content sub-page"
        id="panel-photos"
        role="tabpanel"
        aria-labelledby="tab-photos"
      >
        <h2>
          Photo Albums{' '}
          <span
            style={{
              color: '#a0a9b7',
              font: 'normal 11px Tahoma, Arial, sans-serif',
            }}
          >
            (3 albums)
          </span>
        </h2>
        <p
          style={{
            fontSize: '11px',
            color: '#7c8796',
            marginBottom: '15px',
          }}
        >
          A few snapshots from the simpler days of the web.
        </p>
        <div className="photo-grid">
          <div className="photo-tile">
            <div
              className="photo-scene"
              style={{
                background: 'linear-gradient(160deg,#adcadf,#f4d4a3)',
              }}
            >
              📷
            </div>
            <div className="photo-caption">Summer &apos;08 — 12 photos</div>
          </div>
          <div className="photo-tile">
            <div
              className="photo-scene"
              style={{
                background: 'linear-gradient(160deg,#cad4ee,#d0a9b7)',
              }}
            >
              💿
            </div>
            <div className="photo-caption">My Computer — 8 photos</div>
          </div>
          <div className="photo-tile">
            <div
              className="photo-scene"
              style={{
                background: 'linear-gradient(160deg,#b6d8d0,#e5d2af)',
              }}
            >
              🌴
            </div>
            <div className="photo-caption">Weekend Away — 4 photos</div>
          </div>
        </div>
      </section>
    );
  }

  if (activeTab === 'notes') {
    return (
      <section
        className="tab-content sub-page"
        id="panel-notes"
        role="tabpanel"
        aria-labelledby="tab-notes"
      >
        <h2>Notes</h2>
        <article className="note">
          <div className="note-title">A quick note about this place</div>
          <small>Posted a long time ago</small>
          <p>
            Welcome to FB/08. Leave a message, say hi to someone, or tell us
            what you miss about the early internet.
          </p>
        </article>
        <article className="note">
          <div className="note-title">The rules of the Wall</div>
          <small>Updated for the modern web</small>
          <p>
            Be kind, avoid sharing personal details, and keep posts under 280
            characters. Good conversations don&apos;t need an algorithm.
          </p>
        </article>
      </section>
    );
  }

  return (
    <section
      className="tab-content sub-page"
      id="panel-boxes"
      role="tabpanel"
      aria-labelledby="tab-boxes"
    >
      <h2>Boxes</h2>
      <div className="section-heading">Wall Guestbook</div>
      <div
        className="side-body"
        style={{ border: '1px solid #e4e8ee', borderTop: 0 }}
      >
        You&apos;ve found a tiny guestbook on the internet.{' '}
        <button
          type="button"
          className="subtle-action"
          onClick={onGoToWall}
        >
          Sign the Wall →
        </button>
      </div>
      <div className="section-heading" style={{ marginTop: '16px' }}>
        Wall Stats
      </div>
      <div
        className="side-body"
        style={{ border: '1px solid #e4e8ee', borderTop: 0 }}
      >
        Local preview posts: <strong id="box-count">{postCount}</strong>
        <br />
        Character limit: <strong>280</strong>
        <br />
        Theme: <strong>Forever 2008</strong>
      </div>
    </section>
  );
}
