'use client';

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

/**
 * Minimal on-chain helpers for the World ID verify flow (Sepolia).
 *
 * Model B: the USER submits their own signed claim. We resolve their Identity via IdentityFactory,
 * then call Identity.submitClaim(topic, issuer, sig, data) from the user's wallet (window.ethereum).
 * Reads use a public RPC; writes use the injected wallet. Addresses: see docs/DEPLOYMENTS.md.
 */
const IDENTITY_FACTORY = '0x23504699EAcc1842d01998C0D57C53a2CF1638A0' as Address;
const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const FACTORY_ABI = parseAbi(['function identityOfWallet(address) view returns (address)']);
const IDENTITY_ABI = parseAbi([
  'function submitClaim(uint256 topic, address issuer, bytes sig, bytes data) returns (bytes32)',
]);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

/** The user's ERC-734 Identity contract, or null if they have not created one yet. */
export async function getIdentity(wallet: Address): Promise<Address | null> {
  const identity = (await publicClient.readContract({
    address: IDENTITY_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'identityOfWallet',
    args: [wallet],
  })) as Address;
  return identity === zeroAddress ? null : identity;
}

/** Submit a signed claim to the user's own Identity (Model B). Returns the tx hash. */
export async function submitClaim(params: {
  wallet: Address;
  identity: Address;
  topic: bigint;
  issuer: Address;
  signature: Hex;
  data: Hex;
}): Promise<Hex> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet found. Connect MetaMask to submit your claim.');
  }
  const walletClient = createWalletClient({
    account: params.wallet,
    chain: sepolia,
    transport: custom(window.ethereum),
  });

  const hash = await walletClient.writeContract({
    address: params.identity,
    abi: IDENTITY_ABI,
    functionName: 'submitClaim',
    args: [params.topic, params.issuer, params.signature, params.data],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
