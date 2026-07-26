'use client';

import type { WalletAdapter } from './wallet.types';

declare global {
  interface Window {
    // Typed as `any` to stay compatible with the ambient `window.ethereum` declaration that viem/wagmi
    // ships (TS requires subsequent global declarations to share the same type).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}

export const metamaskAdapter: WalletAdapter = {
  async connectWallet(): Promise<string> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask not found. Please install the MetaMask extension.');
    }
    const accounts = (await window.ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from MetaMask.');
    }
    return accounts[0];
  },

  async getConnectedWallet(): Promise<string | null> {
    if (typeof window === 'undefined' || !window.ethereum) return null;
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_accounts',
      })) as string[];
      return accounts?.[0] ?? null;
    } catch {
      return null;
    }
  },

  onAccountsChanged(callback: (address: string | null) => void): () => void {
    if (typeof window === 'undefined' || !window.ethereum) return () => {};
    const handler = (accounts: unknown) => {
      const list = accounts as string[];
      callback(list.length > 0 ? list[0] : null);
    };
    window.ethereum.on('accountsChanged', handler);
    return () => window.ethereum?.removeListener('accountsChanged', handler);
  },
};
