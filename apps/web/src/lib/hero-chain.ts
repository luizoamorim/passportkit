'use client';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { namehash } from 'viem/ens';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { getClaimValid, TOPICS } from './world-chain';

/**
 * Deployed on Sepolia (docs/DEPLOYMENTS.md). Overridable so a redeployed stack is an env
 * change, not a code edit — the API side is already fully env-driven, and these must agree
 * with `PASSPORT_RESOLVER_ADDRESS` / `GATED_ERC20_ADDRESS` in the API's env.
 */
const RESOLVER = (process.env.NEXT_PUBLIC_PASSPORT_RESOLVER_ADDRESS ??
  '0x14a83c7aE0667e90ff3863C6eF12539F67e4Cd58') as Address;
const GATED_TOKEN = (process.env.NEXT_PUBLIC_GATED_ERC20_ADDRESS ??
  '0xe3a29101263567c400A0d4d47C52912d3Ed0a08d') as Address;
const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const RESOLVER_ABI = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
  'function agentRegistrationKey(address agent) view returns (string)',
  'function agentReputationKey(address agent) pure returns (string)',
]);
const GATED_ABI = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

export type PassportStatus = 'NONE' | 'LIMITED' | 'GREEN' | 'REVOKED';

/** The live ENS-resolved compliance status (NONE / GREEN / REVOKED) for a name. */
export async function readComplianceStatus(ensName: string): Promise<string> {
  return (await publicClient.readContract({
    address: RESOLVER,
    abi: RESOLVER_ABI,
    functionName: 'text',
    args: [namehash(ensName), 'compliance.status'],
  })) as string;
}

/**
 * Passport badge status. ENS is the source of truth for REVOKED (the resolver recomputes it live);
 * LIMITED vs GREEN comes from the actual claims (KYC only vs KYC + accredited).
 */
export async function readPassportStatus(identity: Address, ensName: string): Promise<PassportStatus> {
  const [ens, kyc, accredited] = await Promise.all([
    readComplianceStatus(ensName).catch(() => 'NONE'),
    getClaimValid(identity, TOPICS.KYC_VERIFIED).catch(() => false),
    getClaimValid(identity, TOPICS.ACCREDITED_INVESTOR).catch(() => false),
  ]);
  if (ens === 'REVOKED') return 'REVOKED';
  if (kyc && accredited) return 'GREEN';
  if (kyc) return 'LIMITED';
  return 'NONE';
}

/** Live ENSIP-25 agent registration ("1" if linked) + reputation score for an agent name. */
export async function readAgentEns(
  agentEnsName: string,
  agentWallet: Address,
): Promise<{ registration: string; reputation: string }> {
  const node = namehash(agentEnsName);
  const [regKey, repKey] = await Promise.all([
    publicClient.readContract({
      address: RESOLVER,
      abi: RESOLVER_ABI,
      functionName: 'agentRegistrationKey',
      args: [agentWallet],
    }) as Promise<string>,
    publicClient.readContract({
      address: RESOLVER,
      abi: RESOLVER_ABI,
      functionName: 'agentReputationKey',
      args: [agentWallet],
    }) as Promise<string>,
  ]);
  const [registration, reputation] = await Promise.all([
    publicClient.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'text', args: [node, regKey] }) as Promise<string>,
    publicClient.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'text', args: [node, repKey] }) as Promise<string>,
  ]);
  return { registration, reputation };
}

/** A fresh agent wallet (Model A). The key lives only in this session (React state). */
export function newAgentWallet(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

export async function gatedBalanceOf(wallet: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: GATED_TOKEN,
    abi: GATED_ABI,
    functionName: 'balanceOf',
    args: [wallet],
  })) as bigint;
}

/**
 * The agent acts on Casa Azul's compliant liquidity: it transfers the gated token. GatedERC20 resolves
 * identityOfWallet(agent) -> the PERSON's identity -> isEligible. Succeeds while the person is KYC'd;
 * REVERTS (NotEligible) once the person is revoked. Signed by the agent's own session key (Model A).
 */
export async function agentTransfer(params: {
  agentPrivateKey: Hex;
  to: Address;
  amount?: string; // ether units, default 10
}): Promise<Hex> {
  const account = privateKeyToAccount(params.agentPrivateKey);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });
  const hash = await walletClient.writeContract({
    address: GATED_TOKEN,
    abi: GATED_ABI,
    functionName: 'transfer',
    args: [params.to, parseEther(params.amount ?? '10')],
    gas: BigInt(300_000),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
