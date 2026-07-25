import type { Metadata } from 'next';
import './globals.css';
import { PrivyAppProvider } from '@/providers/PrivyAppProvider';
import { Web3Provider } from '@/providers/Web3Provider';

export const metadata: Metadata = {
  title: 'PassportCreds by Node',
  description: 'White-label Compliance Passport for regulated access.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Web3Provider>
          <PrivyAppProvider>{children}</PrivyAppProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
