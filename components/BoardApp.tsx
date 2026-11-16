'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTextboard } from '@/features/board/use-textboard';
import { useProfile } from '@/features/profile/use-profile';
import { AccountSidebar } from './AccountSidebar';
import { BoardHeader } from './BoardHeader';
import { PeopleView } from './PeopleView';
import { ProfileView } from './ProfileView';
import { ThreadIndex } from './ThreadIndex';
import { ThreadView } from './ThreadView';
import { Toast } from './Toast';

type ActiveView = 'board' | 'people' | 'profile';

export function BoardApp() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<ActiveView>('board');
  const [activeProfileUsername, setActiveProfileUsername] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const profileParam = params.get('profile')?.trim();
      const viewParam = params.get('view');
      if (profileParam) {
        setActiveProfileUsername(profileParam);
        setActiveView('profile');
      } else if (viewParam === 'people') {
        setActiveProfileUsername(null);
        setActiveView('people');
      } else {
        setActiveProfileUsername(null);
        setActiveView('board');
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const updateUrl = useCallback((view: ActiveView, profileUsername: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('profile');
    url.searchParams.delete('view');
    if (view === 'profile' && profileUsername) {
      url.searchParams.set('profile', profileUsername);
    } else if (view === 'people') {
      url.searchParams.set('view', 'people');
    }
    window.history.pushState({}, '', url.toString());
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

  const {
    user,
    isAuthLoading,
    isAuthSubmitting,
    authError,
    clearAuthError,
    threads,
    visibleThreads,
    selectedThread,
    selectedThreadId,
    threadPosts,
    isThreadOwner,
    searchQuery,
    setSearchQuery,
    connectionStatus,
    isLoading,
    isLoadingThread,
    isSubmitting,
    errorMessage,
    clearError,
    registerAccount,
    loginAccount,
    logoutAccount,
    selectThread,
    createThread,
    createReply,
    editPost,
    deleteReply,
    deleteSelectedThread,
    retryLoad,
  } = useTextboard(showToast);

  const profileState = useProfile(
    user,
    activeView === 'profile' ? activeProfileUsername : null,
    showToast
  );

  const handleSelectThread = useCallback(
    (threadId: string | null) => {
      setActiveView('board');
      setActiveProfileUsername(null);
      updateUrl('board', null);
      selectThread(threadId);
      mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [selectThread, updateUrl]
  );

  const handleShowPeople = useCallback(() => {
    setActiveView('people');
    setActiveProfileUsername(null);
    updateUrl('people', null);
    void profileState.loadDirectory(searchQuery);
    mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [profileState, searchQuery, updateUrl]);

  const handleOpenProfile = useCallback(
    (username: string) => {
      const trimmed = username.trim();
      if (!trimmed) return;
      setActiveProfileUsername(trimmed);
      setActiveView('profile');
      updateUrl('profile', trimmed);
      mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [updateUrl]
  );

  return (
    <>
      <BoardHeader
        user={user}
        searchQuery={searchQuery}
        activeView={activeView}
        activeProfileUsername={activeProfileUsername}
        onSearchChange={setSearchQuery}
        onShowBoard={() => handleSelectThread(null)}
        onShowPeople={handleShowPeople}
        onOpenProfile={handleOpenProfile}
      />

      <div className="page" id="top">
        <div className="layout">
          <AccountSidebar
            user={user}
            isAuthLoading={isAuthLoading}
            isAuthSubmitting={isAuthSubmitting}
            authError={authError}
            threads={threads}
            selectedThreadId={activeView === 'board' ? selectedThreadId : null}
            directory={profileState.directory}
            activeProfileUsername={
              activeView === 'profile' ? activeProfileUsername : null
            }
            onClearAuthError={clearAuthError}
            onLogin={loginAccount}
            onRegister={registerAccount}
            onLogout={logoutAccount}
            onSelectThread={handleSelectThread}
            onOpenProfile={handleOpenProfile}
          />

          <main ref={mainRef} className="main-panel">
            <div className="mobile-search-row">
              <label className="top-search" aria-label="Search board and people">
                <input
                  id="mobile-search"
                  type="search"
                  placeholder="Search board & people"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <span className="search-icon" aria-hidden="true">
                  <Search className="svg-icon" strokeWidth={2.3} />
                </span>
              </label>
            </div>

            {activeView === 'profile' && activeProfileUsername ? (
              <ProfileView
                key={activeProfileUsername.toLowerCase()}
                username={activeProfileUsername}
                viewer={user}
                profile={profileState.profile}
                posts={profileState.posts}
                isLoading={profileState.isLoadingProfile}
                isSubmitting={profileState.isSubmittingProfile}
                errorMessage={profileState.profileError}
                onBackToBoard={() => handleSelectThread(null)}
                onOpenProfile={handleOpenProfile}
                onClearError={profileState.clearProfileError}
                onUploadAvatar={profileState.uploadAvatar}
                onRemoveAvatar={profileState.removeAvatar}
                onToggleFollow={profileState.toggleFollow}
                onPublishPost={profileState.publishPost}
                onUpdatePost={profileState.updatePost}
                onDeletePost={profileState.deletePost}
                onAddComment={profileState.addComment}
                onDeleteComment={profileState.removeComment}
              />
            ) : activeView === 'people' ? (
              <PeopleView
                profiles={profileState.directory}
                viewer={user}
                searchQuery={searchQuery}
                isLoading={profileState.isLoadingDirectory}
                isSubmitting={profileState.isSubmittingProfile}
                onOpenProfile={handleOpenProfile}
                onToggleFollow={profileState.toggleFollow}
              />
            ) : selectedThreadId ? (
              <ThreadView
                key={selectedThreadId}
                user={user}
                thread={selectedThread}
                threadId={selectedThreadId}
                posts={threadPosts}
                isThreadOwner={isThreadOwner}
                searchQuery={searchQuery}
                connectionStatus={connectionStatus}
                isLoadingThread={isLoadingThread}
                isSubmitting={isSubmitting}
                errorMessage={errorMessage}
                onBack={() => handleSelectThread(null)}
                onOpenProfile={handleOpenProfile}
                onCreateReply={createReply}
                onEditPost={editPost}
                onDeleteReply={deleteReply}
                onDeleteThread={deleteSelectedThread}
                onRetry={retryLoad}
                onClearError={clearError}
              />
            ) : (
              <ThreadIndex
                user={user}
                threads={visibleThreads}
                totalCount={threads.length}
                searchQuery={searchQuery}
                connectionStatus={connectionStatus}
                isLoading={isLoading}
                isSubmitting={isSubmitting}
                errorMessage={errorMessage}
                onSelectThread={handleSelectThread}
                onOpenProfile={handleOpenProfile}
                onCreateThread={createThread}
                onRetry={retryLoad}
                onClearError={clearError}
              />
            )}

            <footer className="footer">
              <span>FB/08 Textboard &amp; Profiles · Live Realtime</span>
              <span> · Guests read · Post with your username or anonymously</span>
            </footer>
          </main>
        </div>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </>
  );
}
