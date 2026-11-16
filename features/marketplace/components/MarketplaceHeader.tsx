'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoardHeader } from '@/components/BoardHeader';
import type { BoardUser } from '@/features/board/board.types';

export function MarketplaceHeader() {
  const router = useRouter();
  const [user, setUser] = useState<BoardUser | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { signal: controller.signal, cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => { if (data?.user) setUser(data.user); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  return <BoardHeader user={user} activeView="marketplace" activeProfileUsername={null} searchQuery="" onSearchChange={() => undefined} onShowBoard={() => router.push('/')} onShowPeople={() => router.push('/?view=people')} onOpenProfile={username => router.push('/?profile=' + encodeURIComponent(username))} />;
}
