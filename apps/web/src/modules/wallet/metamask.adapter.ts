'use client';

import type { WalletAdapter } from './wallet.types';

/**
 * `window.ethereum` is already declared globally as `any` by @privy-io/react-auth, and merged
 * interface declarations must agree — a second `declare global` here is a compile error
 * (TS2717) that also fails `next build`. So keep the shape local and cast at the boundary,
 * the same way lib/useEthProvider.ts and lib/world-chain.ts already do.
 */
interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

function injected(): InjectedProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { ethereum?: InjectedProvider }).ethereum;
}

export const metamaskAdapter: WalletAdapter = {
  async connectWallet(): Promise<string> {
    const ethereum = injected();
    if (!ethereum) {
      throw new Error('MetaMask not found. Please install the MetaMask extension.');
    }
    const accounts = (await ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from MetaMask.');
    }
    return accounts[0];
  },

  async getConnectedWallet(): Promise<string | null> {
    const ethereum = injected();
    if (!ethereum) return null;
    try {
      const accounts = (await ethereum.request({
        method: 'eth_accounts',
      })) as string[];
      return accounts?.[0] ?? null;
    } catch {
      return null;
    }
  },

  onAccountsChanged(callback: (address: string | null) => void): () => void {
    const ethereum = injected();
    if (!ethereum) return () => {};
    const handler = (accounts: unknown) => {
      const list = accounts as string[];
      callback(list.length > 0 ? list[0] : null);
    };
    ethereum.on('accountsChanged', handler);
    return () => ethereum.removeListener('accountsChanged', handler);
  },
};
