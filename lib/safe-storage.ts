export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getBrowserStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function safeReadRaw(
  key: string,
  storage: StorageAdapter | null = getBrowserStorage()
): { ok: boolean; value: string | null } {
  if (!storage) {
    return { ok: false, value: null };
  }
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

export function safeReadJSON<T>(
  key: string,
  fallback: T,
  storage: StorageAdapter | null = getBrowserStorage()
): { ok: boolean; value: T } {
  const raw = safeReadRaw(key, storage);
  if (!raw.ok) {
    return { ok: false, value: fallback };
  }
  if (raw.value === null) {
    return { ok: true, value: fallback };
  }
  try {
    return { ok: true, value: JSON.parse(raw.value) as T };
  } catch {
    return { ok: false, value: fallback };
  }
}

export function safeWriteJSON<T>(
  key: string,
  value: T,
  storage: StorageAdapter | null = getBrowserStorage()
): { ok: boolean; error?: string } {
  if (!storage) {
    return {
      ok: false,
      error: 'Browser storage is unavailable. Your changes may not survive a refresh.',
    };
  }
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Browser storage is blocked or full. Your post could not be saved locally.',
    };
  }
}
