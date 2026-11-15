import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FB/08 — Your little corner of the internet',
  description: 'A nostalgic 2008-era public community wall and retro social profile guestbook.',
  openGraph: {
    title: 'FB/08 — Your little corner of the internet',
    description: 'A nostalgic 2008-era public community wall and retro social profile guestbook.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FB/08 — Your little corner of the internet',
    description: 'A nostalgic 2008-era public community wall and retro social profile guestbook.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3b5998',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
