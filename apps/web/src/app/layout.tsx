import type { Metadata } from 'next';
import './globals.css';
import { PrivyAppProvider } from '@/providers/PrivyAppProvider';

export const metadata: Metadata = {
  title: 'PassportKit Node',
  description: 'Compliance credential rails for wallets, apps and agents.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PrivyAppProvider>{children}</PrivyAppProvider>
      </body>
    </html>
  );
}
