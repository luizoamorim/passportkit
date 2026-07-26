'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Address } from 'viem';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { WorldVerifyCard } from '@/components/world/WorldVerifyCard';
import { getIdentity } from '@/lib/world-chain';
import { shortenAddress } from '@/lib/format';

export default function VerifyPage() {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [identity, setIdentity] = useState<Address | null>(null);
  const [loading, setLoading] = useState(false);
  const [noIdentity, setNoIdentity] = useState(false);
  const [lastTx, setLastTx] = useState<{ kind: string; hash: string } | null>(null);

  const handleConnect = useCallback(async (addr: string) => {
    const w = addr as Address;
    setWallet(w);
    setLoading(true);
    setNoIdentity(false);
    try {
      const id = await getIdentity(w);
      setIdentity(id);
      setNoIdentity(id === null);
    } catch {
      setNoIdentity(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleDisconnect() {
    setWallet(null);
    setIdentity(null);
    setNoIdentity(false);
    setLastTx(null);
  }

  return (
    <div className="min-h-screen bg-[#F0F2F6]">
      <header className="bg-white border-b border-[#DDE1EA]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
              <span className="text-white text-xs font-bold">PK</span>
            </div>
            <span className="font-bold text-[#0D1428] text-sm">PassportKit</span>
          </Link>
          <ConnectWalletButton onConnect={handleConnect} onDisconnect={handleDisconnect} address={wallet} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
          Real Verification
        </p>
        <h1 className="text-2xl font-bold text-[#0D1428] mb-1">
          Prove it with{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            World ID
          </span>
        </h1>
        <p className="text-sm text-[#4B5568] mb-8 max-w-2xl">
          World ID is the one real verification in this demo. Personhood and KYC become on-chain claims on
          your own identity (Model B) — accredited stays a labeled mock.
        </p>

        {!wallet && (
          <div className="bg-white border border-[#DDE1EA] rounded-2xl p-10 text-center shadow-sm">
            <p className="text-4xl mb-4">🌍</p>
            <h2 className="text-lg font-bold text-[#0D1428] mb-2">Connect your wallet</h2>
            <p className="text-sm text-[#4B5568] mb-6">
              Connect the wallet that owns your PassportKit identity to run a World ID verification.
            </p>
            <div className="flex justify-center">
              <ConnectWalletButton onConnect={handleConnect} address={null} />
            </div>
          </div>
        )}

        {wallet && loading && (
          <div className="text-center py-12 text-[#4B5568] text-sm">Resolving your identity…</div>
        )}

        {wallet && !loading && noIdentity && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-800">
            <p className="font-semibold mb-1">No identity found for {shortenAddress(wallet)}</p>
            <p>
              This wallet has no PassportKit identity yet. Create one first (the backend
              <span className="font-mono"> POST /identity/create</span>), then return here to verify.
            </p>
          </div>
        )}

        {wallet && !loading && identity && (
          <div className="space-y-4">
            <div className="text-xs text-[#4B5568]">
              Identity <span className="font-mono text-[#0D1428]">{shortenAddress(identity)}</span>
            </div>
            <WorldVerifyCard
              wallet={wallet}
              identity={identity}
              onVerified={(kind, hash) => setLastTx({ kind, hash })}
            />
            {lastTx && (
              <div className="bg-[#EAF7F0] border border-[#B8E6CE] rounded-xl px-4 py-3 text-sm text-[#0B7A4B]">
                ✓ {lastTx.kind} claim submitted on-chain.{' '}
                <a
                  href={`https://sepolia.etherscan.io/tx/${lastTx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View transaction ↗
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
