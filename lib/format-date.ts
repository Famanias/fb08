export function formatWallTimestamp(
  isoDate: string,
  nowMs: number = Date.now()
): string {
  const date = new Date(isoDate);
  const timeMs = date.getTime();
  if (!Number.isFinite(timeMs)) {
    return 'Recently';
  }
  const diffMs = nowMs - timeMs;
  if (diffMs < 60_000) {
    return 'Just now';
  }
  if (diffMs < 3_600_000) {
    const minutes = Math.floor(diffMs / 60_000);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (diffMs < 86_400_000) {
    return `Today at ${date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  if (diffMs < 172_800_000) {
    return `Yesterday at ${date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatFullTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}
