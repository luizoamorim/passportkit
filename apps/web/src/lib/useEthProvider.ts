'use client';

import { useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import type { EIP1193Provider } from 'viem';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Returns a getter for the connected wallet's EIP-1193 provider, used to sign the user's own txs.
 *
 * Privy's embedded wallet does NOT inject `window.ethereum` — its provider comes from
 * `useWallets().getEthereumProvider()`. Injected wallets (MetaMask) use `window.ethereum`.
 *
 * `HAS_PRIVY` is a build-time constant, so the hook order is stable across renders even though the
 * branch guards `useWallets` (which throws outside a PrivyProvider, mounted only when HAS_PRIVY).
 */
export function useEthProvider(): () => Promise<EIP1193Provider> {
  if (!HAS_PRIVY) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCallback(async () => {
      if (typeof window === 'undefined' || !window.ethereum) throw new Error('No wallet provider');
      return window.ethereum as unknown as EIP1193Provider;
    }, []);
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { wallets } = useWallets();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useCallback(async () => {
    const w = wallets.find((x) => x.walletClientType === 'privy') ?? wallets[0];
    if (w) return (await w.getEthereumProvider()) as EIP1193Provider;
    if (typeof window !== 'undefined' && window.ethereum) {
      return window.ethereum as unknown as EIP1193Provider;
    }
    throw new Error('No wallet provider');
  }, [wallets]);
}
