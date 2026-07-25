'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The one nav for the whole site: Passport · Deal Room · Markets · Concierge.
 *
 * `/markets` and `/concierge` are driven entirely by `/api/demo/*`, which is a
 * 403 unless `DEMO_MODE=true` — so they are hidden when the demo runtime is off
 * rather than linking to a page that can only report a 403.
 */

type NavItem = { href: string; label: string; demoOnly?: boolean };

const ITEMS: NavItem[] = [
  { href: '/passport', label: 'Passport' },
  { href: '/deal-room', label: 'Deal Room' },
  { href: '/markets', label: 'Markets', demoOnly: true },
  { href: '/concierge', label: 'Concierge', demoOnly: true },
];

export function Nav({ demoEnabled }: { demoEnabled: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.demoOnly || demoEnabled);

  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              active
                ? 'bg-[#0D1428] text-white'
                : 'text-[#4B5568] hover:text-[#0D1428] hover:bg-[#F0F2F6]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
