'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';

import { ChainChip, type DemoWorld } from './ChainChip';
import { DemoBanner } from './DemoBanner';
import { Nav } from './Nav';

/**
 * The one frame every route renders inside: brand lockup, nav, chain chip,
 * wallet control, demo banner, footer.
 *
 * It also OWNS the connected wallet. `AppShell` is mounted by the root layout,
 * so App Router keeps this component alive across client navigations — moving
 * the address here is what makes the four pages one app instead of four demos
 * that each ask you to connect again.
 */

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/// The world read is a lot of RPC round trips; local anvil, so 15s is plenty.
const WORLD_POLL_MS = 15_000;

export type WalletKind = 'privy' | 'metamask';

type WalletState = {
  address: string | null;
  provider: WalletKind;
  connect: (address: string, provider?: WalletKind) => void;
  disconnect: () => void;
};

const WalletContext = createContext<WalletState>({
  address: null,
  provider: 'privy',
  connect: () => {},
  disconnect: () => {},
});

/** The connected address, shared by every page under the shell. */
export function useWallet(): WalletState {
  return useContext(WalletContext);
}

/**
 * The connect control, wired to the shell's wallet state.
 *
 * Privy and MetaMask are mutually exclusive here, exactly as the pages had it
 * before the shell existed: with `NEXT_PUBLIC_PRIVY_APP_ID` set the embedded
 * wallet is the only path (`ConnectWalletButton` would auto-connect an injected
 * account on mount and race it), without it MetaMask is.
 *
 * Pages render this inside their own empty states; the shell renders it in the
 * header. Both read and write the same address.
 */
export function WalletConnectControl() {
  const { address, provider, connect, disconnect } = useWallet();

  const onPrivy = useCallback((addr: string) => connect(addr, 'privy'), [connect]);
  const onMetaMask = useCallback((addr: string) => connect(addr, 'metamask'), [connect]);

  if (HAS_PRIVY) {
    return (
      <PrivyLoginButton
        onWalletReady={onPrivy}
        onDisconnect={disconnect}
        address={provider === 'privy' ? address : null}
      />
    );
  }

  return (
    <ConnectWalletButton
      onConnect={onMetaMask}
      onDisconnect={disconnect}
      address={provider === 'metamask' ? address : null}
    />
  );
}

/**
 * Probes `/api/demo/world` and keeps it fresh.
 *
 * A 403 is not an error — it is the answer "this build has no demo runtime".
 * We stop polling then, hide the banner and the demo-only nav entries, and
 * leave the rest of the site alone. `enabled` stays `null` until the first
 * answer so the nav shows every route rather than flashing two entries in.
 */
function useDemoWorld(): { world: DemoWorld | null; enabled: boolean | null } {
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const enabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = (isEnabled: boolean) => {
      enabledRef.current = isEnabled;
      setEnabled(isEnabled);
      if (!isEnabled) setWorld(null);
    };

    async function probe() {
      let again = true;
      try {
        const res = await fetch('/api/demo/world', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 403) {
          stop(false);
          return; // demo runtime is off — nothing to poll for
        }
        enabledRef.current = true;
        setEnabled(true);
        // A 5xx means the runtime is on and the chain is unhappy; keep the last
        // good world on screen and try again rather than blanking the chip.
        if (res.ok) setWorld((await res.json()) as DemoWorld);
      } catch {
        if (cancelled) return;
        // Never answered — treat as off unless a previous probe said otherwise.
        if (enabledRef.current !== true) {
          stop(false);
          again = false;
        }
      }
      if (!cancelled && again) timer = setTimeout(probe, WORLD_POLL_MS);
    }

    probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { world, enabled };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<WalletKind>('privy');
  const { world, enabled } = useDemoWorld();

  const connect = useCallback((addr: string, kind: WalletKind = 'privy') => {
    setAddress(addr);
    setProvider(kind);
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const wallet = useMemo<WalletState>(
    () => ({ address, provider, connect, disconnect }),
    [address, provider, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={wallet}>
      <div className="min-h-screen flex flex-col bg-[#F0F2F6]">
        <header className="sticky top-0 z-40 bg-white border-b border-[#DDE1EA]">
          <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
                <span className="text-white text-xs font-bold">PC</span>
              </div>
              <span className="font-bold text-[#0D1428] text-sm">{PRODUCT_NAME}</span>
            </Link>

            <Nav demoEnabled={enabled !== false} />

            <div className="ml-auto flex items-center gap-3">
              <ChainChip world={world} />
              <WalletConnectControl />
            </div>
          </div>
        </header>

        {enabled === true && <DemoBanner world={world} />}

        <main className="flex-1 flex flex-col">{children}</main>

        <footer className="border-t border-[#DDE1EA] bg-white py-5">
          <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[#9CA3AF]">{PRODUCT_NAME}</span>
            <span className="text-xs text-[#9CA3AF]">ETHGlobal Hackathon Demo</span>
          </div>
        </footer>
      </div>
    </WalletContext.Provider>
  );
}
