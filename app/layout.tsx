import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FB/08 — 2008 Anonymous Textboard',
  description:
    'A nostalgic 2008 Facebook-styled community textboard with account-gated anonymous threads, per-thread IDs, and live edit history.',
  openGraph: {
    title: 'FB/08 — 2008 Anonymous Textboard',
    description:
      'A nostalgic 2008 Facebook-styled community textboard with account-gated anonymous threads, per-thread IDs, and live edit history.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FB/08 — 2008 Anonymous Textboard',
    description:
      'A nostalgic 2008 Facebook-styled community textboard with account-gated anonymous threads, per-thread IDs, and live edit history.',
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
