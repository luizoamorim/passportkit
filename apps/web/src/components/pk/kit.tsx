'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOCK_MODE } from '@/lib/passportkit';
import { useWallet } from '@/lib/useWallet';

export function short(addr?: string | null) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const NAV = [
  { href: '/passport', label: 'My Passport' },
  { href: '/deal-room', label: 'Deal Room' },
  { href: '/agents', label: 'My Agents' },
];

export function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h3 className="text-sm font-semibold text-[#0D1428]">{title}</h3>}
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      {(title || subtitle) && <div className="mt-3" />}
      {children}
    </div>
  );
}

const PILL: Record<string, string> = {
  green: 'bg-teal-50 text-teal-600 border-teal-200',
  blue: 'bg-blue-50 text-blue-600 border-blue-200',
  red: 'bg-red-50 text-red-600 border-red-200',
  slate: 'bg-slate-100 text-slate-500 border-slate-200',
  amber: 'bg-amber-50 text-amber-600 border-amber-200',
};

export function Pill({ tone = 'slate', children }: { tone?: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${PILL[tone]}`}
    >
      {children}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = 'primary',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
}) {
  const styles = {
    primary: 'bg-[#0D1428] text-white hover:bg-[#141E38]',
    ghost: 'bg-white text-[#0D1428] border border-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function WalletBar() {
  const { wallet, demo, connect, useDemoWallet, disconnect } = useWallet();
  if (!wallet) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => connect().catch(() => {})}
          className="rounded-lg bg-[#0D1428] px-4 py-2 text-sm font-semibold text-white hover:bg-[#141E38]"
        >
          Connect Wallet
        </button>
        <button
          onClick={useDemoWallet}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Use demo wallet
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {demo && <Pill tone="amber">demo wallet</Pill>}
      <span className="w-2 h-2 rounded-full bg-[#3DDBD9]" />
      <span className="font-mono text-sm text-slate-600">{short(wallet)}</span>
      <button
        onClick={disconnect}
        className="text-xs text-slate-400 hover:text-red-500"
        title="Disconnect"
      >
        ✕
      </button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {MOCK_MODE && (
        <div className="bg-amber-100 text-amber-800 text-center text-xs py-1.5 font-medium">
          DEMO MODE — mocked data, no chain writes. Real wiring drops in after the Sepolia deploy.
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold text-[#0D1428]">PassportKit</span>
            <span className="rounded bg-[#0D1428] px-1.5 py-0.5 text-[10px] font-bold text-white">
              NODE
            </span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {NAV.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    active ? 'bg-slate-100 text-[#0D1428]' : 'text-slate-500 hover:text-[#0D1428]'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <WalletBar />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
