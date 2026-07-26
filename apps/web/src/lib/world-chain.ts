'use client';

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  parseAbi,
  toHex,
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
const CLAIM_ISSUER = '0x56F97734cC4d80af950538eAA6976398b5E58Fa9' as Address;
const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

/** Claim topic ids = uint256(keccak256(name)) — must match contracts/src/libraries/Types.sol. */
export const TOPICS = {
  PROOF_OF_PERSONHOOD: BigInt(keccak256(toHex('PROOF_OF_PERSONHOOD'))),
  KYC_VERIFIED: BigInt(keccak256(toHex('KYC_VERIFIED'))),
  ACCREDITED_INVESTOR: BigInt(keccak256(toHex('ACCREDITED_INVESTOR'))),
};

const FACTORY_ABI = parseAbi(['function identityOfWallet(address) view returns (address)']);
const IDENTITY_ABI = parseAbi([
  'function submitClaim(uint256 topic, address issuer, bytes sig, bytes data) returns (bytes32)',
  'function getClaim(uint256 topic, address issuer) view returns (bool exists, bytes sig, bytes data)',
]);
const CLAIM_ISSUER_ABI = parseAbi([
  'function isClaimValid(address identity, uint256 topic, bytes sig, bytes data) view returns (bool)',
]);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

/**
 * Is there a currently-VALID claim for this topic on the identity? Reads the claim off the Identity,
 * then re-verifies with the ClaimIssuer (so a revoked/expired claim reads as false) — mirrors the gate.
 */
export async function getClaimValid(identity: Address, topic: bigint): Promise<boolean> {
  const [exists, sig, data] = (await publicClient.readContract({
    address: identity,
    abi: IDENTITY_ABI,
    functionName: 'getClaim',
    args: [topic, CLAIM_ISSUER],
  })) as [boolean, Hex, Hex];
  if (!exists) return false;
  return (await publicClient.readContract({
    address: CLAIM_ISSUER,
    abi: CLAIM_ISSUER_ABI,
    functionName: 'isClaimValid',
    args: [identity, topic, sig, data],
  })) as boolean;
}

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
    // Explicit gas: the demo wallet is EIP-7702 delegated, where viem's gas estimation can fall back
    // to a ~21M limit that exceeds the RPC provider cap (Infura ~16.77M). A claim submit is well under
    // this, so a fixed generous limit avoids the "gas limit too high" rejection.
    gas: BigInt(1_000_000),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
