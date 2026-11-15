'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WallTab } from '@/features/wall/post.types';
import { useWallPosts } from '@/features/wall/use-wall-posts';
import { PostComposer } from './PostComposer';
import { PostFeed } from './PostFeed';
import { ProfileSidebar } from './ProfileSidebar';
import { RetroAdsSidebar } from './RetroAdsSidebar';
import { StaticTabContent } from './StaticTabContent';
import { Toast } from './Toast';
import { WallHeader } from './WallHeader';
import { WallTabs } from './WallTabs';

export function WallApp() {
  const {
    visiblePosts,
    totalCount,
    displayName,
    searchQuery,
    setSearchQuery,
    isLoading,
    isPosting,
    errorMessage,
    clearError,
    connectionStatus,
    demoInteractions,
    createPost,
    updateDisplayName,
    toggleLike,
    addComment,
  } = useWallPosts();

  const [activeTab, setActiveTab] = useState<WallTab>('wall');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState<boolean>(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 2600);
  }, []);

  const selectTab = useCallback((tab: WallTab, scrollToMain: boolean = true) => {
    setActiveTab(tab);
    if (scrollToMain && mainRef.current) {
      mainRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setActiveTab('wall');
    },
    [setSearchQuery]
  );

  const handleWriteOnWall = useCallback(() => {
    setActiveTab('wall');
    setTimeout(() => {
      composerTextareaRef.current?.focus();
    }, 120);
  }, []);

  const handlePoke = useCallback(() => {
    showToast('You poked the Wall! 👈 Just like old times.');
  }, [showToast]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Page link copied!');
    } catch {
      showToast('Copy the URL from your browser to share.');
    }
  }, [showToast]);

  const handleScrollTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleBrandClick = useCallback(() => {
    setActiveTab('wall');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <>
      <WallHeader
        activeTab={activeTab}
        displayName={displayName}
        searchQuery={searchQuery}
        onSelectTab={(tab) => selectTab(tab, true)}
        onSearchChange={handleSearchChange}
        onBrandClick={handleBrandClick}
      />

      <div className="page" id="top">
        <div className="layout">
          <ProfileSidebar
            onSelectTab={(tab) => selectTab(tab, true)}
            onWriteOnWall={handleWriteOnWall}
            onPoke={handlePoke}
            onCopyLink={() => void handleCopyLink()}
          />

          <main className="main-panel" id="main-content" ref={mainRef}>
            <div className="wall-header">
              <div>
                <h1>The Community Wall</h1>
                <div className="subtitle">
                  A little corner of the internet, just like it was in 2008.
                </div>
              </div>
              <div className="visitor-stamp">
                Established 2008 &nbsp;·&nbsp;{' '}
                <span id="post-count">{totalCount}</span> wall posts
              </div>
            </div>

            <WallTabs
              activeTab={activeTab}
              onSelectTab={(tab) => selectTab(tab, true)}
            />

            {activeTab === 'wall' ? (
              <section
                className="tab-content"
                id="panel-wall"
                role="tabpanel"
                aria-labelledby="tab-wall"
              >
                <PostComposer
                  displayName={displayName}
                  isPosting={isPosting}
                  errorMessage={errorMessage}
                  textareaRef={composerTextareaRef}
                  onCreatePost={createPost}
                  onUpdateDisplayName={updateDisplayName}
                  onClearError={clearError}
                  onNotify={showToast}
                />

                <PostFeed
                  posts={visiblePosts}
                  totalCount={totalCount}
                  searchQuery={searchQuery}
                  onSearchChange={handleSearchChange}
                  isLoading={isLoading}
                  connectionStatus={connectionStatus}
                  demoInteractions={demoInteractions}
                  onToggleLike={toggleLike}
                  onAddComment={addComment}
                  onNotify={showToast}
                />
              </section>
            ) : (
              <StaticTabContent
                activeTab={activeTab}
                postCount={totalCount}
                onGoToWall={() => selectTab('wall', true)}
              />
            )}
          </main>

          <RetroAdsSidebar postCount={totalCount} />
        </div>

        <footer className="footer">
          <span>
            <strong>fb/08</strong> © 2008–2026 &nbsp; · &nbsp; Inspired by the
            early social web
          </span>
          <span className="footer-actions">
            <button type="button" onClick={() => selectTab('info', true)}>
              About
            </button>
            <button type="button" onClick={() => selectTab('notes', true)}>
              Notes
            </button>
            <button type="button" id="footer-top" onClick={handleScrollTop}>
              Back to top ↑
            </button>
            <span>LOCAL PREVIEW</span>
          </span>
        </footer>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </>
  );
}
