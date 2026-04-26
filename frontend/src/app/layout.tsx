import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spatium Sonorum — A WebGL Journey Through Early Music',
  description:
    'Explore public-domain classical recordings as three-dimensional spaces. Each piece becomes a room you can walk through.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
