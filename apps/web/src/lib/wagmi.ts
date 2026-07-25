import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';

/**
 * Wallet configuration — any wallet, not just MetaMask.
 *
 * Three ways in, all optional for the user:
 *  - injected(): every browser extension. wagmi discovers them individually via
 *    EIP-6963, so MetaMask, Rabby, Brave, Zerion… each appear as their own entry.
 *  - walletConnect(): QR / deep link for any mobile wallet. Needs a free project id
 *    from https://cloud.reown.com — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 *    Without it the connector is simply omitted; everything else still works.
 *  - coinbaseWallet(): works with the extension or the smart-wallet popup, no id.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const walletConnectConfigured = Boolean(projectId);

/** Chain used for claim submission. Defaults to Sepolia, per NEXT_PUBLIC_CHAIN_ID. */
export const activeChain =
  Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? sepolia.id) === mainnet.id ? mainnet : sepolia;

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(projectId
      ? [
          walletConnect({
            projectId,
            metadata: {
              name: 'PassportCreds by Node',
              description: 'White-label Compliance Passport for regulated access.',
              url: typeof window === 'undefined' ? 'http://localhost:3003' : window.location.origin,
              icons: [],
            },
          }),
        ]
      : []),
    coinbaseWallet({ appName: 'PassportCreds by Node' }),
  ],
  transports: {
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
