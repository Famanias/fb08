'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTextboard } from '@/features/board/use-textboard';
import { AccountSidebar } from './AccountSidebar';
import { BoardHeader } from './BoardHeader';
import { ThreadIndex } from './ThreadIndex';
import { ThreadView } from './ThreadView';
import { Toast } from './Toast';

export function BoardApp() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

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

  const handleSelectThread = useCallback(
    (threadId: string | null) => {
      selectThread(threadId);
      mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [selectThread]
  );

  return (
    <>
      <BoardHeader
        user={user}
        searchQuery={searchQuery}
        selectedThreadId={selectedThreadId}
        onSearchChange={setSearchQuery}
        onShowIndex={() => handleSelectThread(null)}
      />

      <div className="page" id="top">
        <div className="layout">
          <AccountSidebar
            user={user}
            isAuthLoading={isAuthLoading}
            isAuthSubmitting={isAuthSubmitting}
            authError={authError}
            threads={threads}
            selectedThreadId={selectedThreadId}
            onClearAuthError={clearAuthError}
            onLogin={loginAccount}
            onRegister={registerAccount}
            onLogout={logoutAccount}
            onSelectThread={handleSelectThread}
          />

          <main ref={mainRef} className="main-panel">
            <div className="mobile-search-row">
              <label className="top-search" aria-label="Search threads and posts">
                <input
                  id="mobile-search"
                  type="search"
                  placeholder="Search threads & posts"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <span className="search-icon" aria-hidden="true">
                  <Search className="svg-icon" strokeWidth={2.3} />
                </span>
              </label>
            </div>

            {selectedThreadId ? (
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
                onCreateThread={createThread}
                onRetry={retryLoad}
                onClearError={clearError}
              />
            )}

            <footer className="footer">
              <span>FB/08 Textboard · Live Realtime</span>
              <span> · Guests read · Post with your username or anonymously</span>
            </footer>
          </main>
        </div>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </>
  );
}
