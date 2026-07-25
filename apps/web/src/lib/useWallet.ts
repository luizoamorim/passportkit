'use client';

import { useCallback, useEffect, useState } from 'react';
import { metamaskAdapter } from '@/modules/wallet/metamask.adapter';

const KEY = 'passportkit:activeWallet';

/**
 * Active wallet shared across the demo pages. Real wallet via MetaMask/Privy, or a generated
 * "demo wallet" so the whole flow is clickable with no extension. Persisted in localStorage.
 */
export function useWallet() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(KEY);
    if (saved) {
      setWallet(saved);
      setDemo(window.localStorage.getItem(KEY + ':demo') === '1');
      return;
    }
    metamaskAdapter.getConnectedWallet().then((a) => {
      if (a) {
        window.localStorage.setItem(KEY, a);
        setWallet(a);
      }
    });
  }, []);

  const set = useCallback((a: string, isDemo: boolean) => {
    window.localStorage.setItem(KEY, a);
    window.localStorage.setItem(KEY + ':demo', isDemo ? '1' : '0');
    setWallet(a);
    setDemo(isDemo);
  }, []);

  const connect = useCallback(async () => {
    const a = await metamaskAdapter.connectWallet();
    set(a, false);
    return a;
  }, [set]);

  const useDemoWallet = useCallback(() => {
    const a =
      '0x' +
      Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    set(a, true);
    return a;
  }, [set]);

  const disconnect = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(KEY + ':demo');
    }
    setWallet(null);
    setDemo(false);
  }, []);

  return { wallet, demo, connect, useDemoWallet, disconnect };
}
