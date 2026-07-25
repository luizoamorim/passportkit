'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { shortenAddress } from '@/lib/format';
import { walletConnectConfigured } from '@/lib/wagmi';

type Props = {
  onConnect: (address: string) => void;
  onDisconnect?: () => void;
  address: string | null;
};

/** Human label for a connector — WalletConnect gets a clearer name than its default. */
function labelFor(name: string, id: string) {
  if (id === 'walletConnect') return 'WalletConnect · scan with any wallet';
  if (id === 'coinbaseWalletSDK') return 'Coinbase Wallet';
  return name;
}

/**
 * Wallet picker. Lists every connector wagmi knows about: each browser extension
 * discovered via EIP-6963, WalletConnect (when a project id is configured) and
 * Coinbase Wallet. Replaces the MetaMask-only button.
 */
export function ConnectMenu({ onConnect, onDisconnect, address }: Props) {
  const { address: connected, isConnected, connector } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  // Surface wagmi's account to the page: covers reconnect on reload, account
  // switches in the wallet, and disconnects initiated from the wallet itself.
  useEffect(() => {
    if (isConnected && connected && connected !== address) onConnect(connected);
    if (!isConnected && address) onDisconnect?.();
  }, [isConnected, connected, address, onConnect, onDisconnect]);

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#3DDBD9] inline-block" />
        <span className="text-sm font-mono text-[#4B5568]">{shortenAddress(address)}</span>
        {connector?.name && (
          <span className="text-[10px] font-semibold text-[#4A9EFF] bg-blue-50 px-1.5 py-0.5 rounded">
            {connector.name}
          </span>
        )}
        <button
          onClick={() => { disconnect(); onDisconnect?.(); }}
          className="text-xs text-[#9CA3AF] hover:text-red-400 transition-colors px-2 py-1 rounded-md hover:bg-red-50 border border-transparent hover:border-red-200"
          title="Disconnect wallet"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-end gap-1">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="bg-[#0D1428] text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#141E38] transition-colors disabled:opacity-50"
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a wallet"
          className="absolute top-12 right-0 z-50 w-72 bg-white border border-[#DDE1EA] rounded-xl shadow-lg p-2"
        >
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] px-2 py-1.5">
            Choose a wallet
          </p>

          {connectors.length === 0 && (
            <p className="text-xs text-[#4B5568] px-2 py-3">No wallet connectors available.</p>
          )}

          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => { connect({ connector: c }); setOpen(false); }}
              className="w-full flex items-center gap-2.5 text-left text-sm px-2 py-2.5 rounded-lg hover:bg-[#F0F2F6] transition-colors"
            >
              {c.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" className="w-5 h-5 rounded" />
              )}
              <span className="font-medium text-[#0D1428]">{labelFor(c.name, c.id)}</span>
            </button>
          ))}

          {!walletConnectConfigured && (
            <p className="text-[11px] text-[#9CA3AF] px-2 pt-2 pb-1 border-t border-[#F0F2F6] mt-1">
              Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to add mobile wallets over WalletConnect.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-500 max-w-[220px] text-right">{error.message}</p>}
    </div>
  );
}
