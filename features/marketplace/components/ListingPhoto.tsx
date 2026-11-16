'use client';
import { useState } from 'react';
export function ListingPhoto({ src, title, lazy = false }: { src: string; title: string; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="photo-unavailable" role="img" aria-label={`Photo unavailable for ${title}`}>Photo unavailable</span>;
  // Native image avoids an extra image proxy and uses only the server-created Storage URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={title} loading={lazy ? 'lazy' : 'eager'} onError={() => setFailed(true)} />;
}
