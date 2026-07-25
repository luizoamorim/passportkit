import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { PrivyAppProvider } from '@/providers/PrivyAppProvider';

export const metadata: Metadata = {
  title: 'PassportCreds by Node',
  description: 'White-label Compliance Passport for regulated access.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PrivyAppProvider>
          <AppShell>{children}</AppShell>
        </PrivyAppProvider>
      </body>
    </html>
  );
}
