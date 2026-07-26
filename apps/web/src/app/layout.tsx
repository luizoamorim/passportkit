import type { Metadata } from 'next';
import './globals.css';
import { PrivyAppProvider } from '@/providers/PrivyAppProvider';

export const metadata: Metadata = {
  title: 'Passport Kit Node',
  description:
    'Give an AI agent real authority over a real asset. Take it back in one transaction. An identity and authorization layer for AI agents operating tokenized real-world assets.',
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
