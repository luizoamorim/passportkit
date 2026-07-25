import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { namehash } from 'viem/ens';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { anvil, sepolia, arbitrumSepolia } from 'viem/chains';

export interface CreateIdentityResult {
  identity: Address; // the deployed ERC-734/735 Identity contract owned by `wallet`
  wallet: Address;
  created: boolean; // false = already existed (idempotent, no tx sent)
  transactionHash: Hex | null; // null when it already existed
}

export interface LinkAgentResult {
  agentWallet: Address;
  personIdentity: Address; // the identity the agent now inherits (Model A)
  linkTransactionHash: Hex;
  subname: string | null; // e.g. "bot1.casaazul.eth" (null if the registrar/parent isn't configured)
  subnameNode: Hex | null; // namehash of the subname
  subnameTransactionHash: Hex | null;
}

export interface UnlinkAgentResult {
  agentWallet: Address;
  transactionHash: Hex;
}

const IDENTITY_FACTORY_ABI = parseAbi([
  'function createIdentity(address wallet) returns (address identity)',
  'function identityOfWallet(address) view returns (address)',
  'function linkAgent(address agentWallet, address personIdentity)',
  'function unlinkAgent(address agentWallet)',
]);

const SUBNAME_REGISTRAR_ABI = parseAbi([
  'function issueSubname(bytes32 parentNode, string label, address userWallet, address identity) returns (bytes32 node)',
]);

function resolveChain(chainId: number): Chain {
  if (chainId === 31337) return anvil;
  if (chainId === 11155111) return sepolia;
  if (chainId === 421614) return arbitrumSepolia;
  return { ...anvil, id: chainId };
}

/**
 * IdentityService — provisions a user's on-chain Identity (Model B).
 *
 * `IdentityFactory.createIdentity(wallet)` is `onlyRole(AGENT_ROLE)`, so ONLY the backend agent key
 * can call it. It deploys a fresh `Identity` whose MANAGEMENT key is the USER's wallet — the user
 * still owns it and submits their own claims; the backend only provisions the container (this is why
 * it's a backend endpoint and not a user wallet tx). Idempotent: if the wallet already has an
 * identity, we return it without sending a tx.
 *
 * Uses AGENT_PRIVATE_KEY (same key as revocation.service). Mirrors it: no crash at boot if the key or
 * factory address is missing — throws only when called.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly account?: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly identityFactoryAddress: Address;
  private readonly subnameRegistrarAddress: Address;
  private readonly parentName: string;

  private readonly publicClient;
  private readonly walletClient?;

  constructor() {
    this.rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
    const chainId = parseInt(process.env.CHAIN_ID ?? '11155111', 10);
    this.chain = resolveChain(chainId);
    this.identityFactoryAddress = (process.env.IDENTITY_FACTORY_ADDRESS ?? '0x') as Address;
    this.subnameRegistrarAddress = (process.env.SUBNAME_REGISTRAR_ADDRESS ?? '0x') as Address;
    this.parentName = process.env.ENS_PARENT_NAME ?? '';

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });

    const pk = (process.env.AGENT_PRIVATE_KEY ?? '') as Hex;
    if (pk && pk !== '0x') {
      this.account = privateKeyToAccount(pk);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport: http(this.rpcUrl),
      });
      this.logger.log(`Agent identity provisioning ready: ${this.account.address}`);
    } else {
      this.logger.warn('AGENT_PRIVATE_KEY not set — identity creation disabled until configured');
    }
  }

  async createIdentity(wallet: Address): Promise<CreateIdentityResult> {
    if (
      this.identityFactoryAddress === ('0x' as Address) ||
      this.identityFactoryAddress === zeroAddress
    ) {
      throw new Error('IDENTITY_FACTORY_ADDRESS not configured');
    }

    // Idempotent: return the existing identity without a tx.
    const existing = await this.readIdentityOfWallet(wallet);
    if (existing !== zeroAddress) {
      this.logger.log(`identity already exists for ${wallet}: ${existing}`);
      return { identity: existing, wallet, created: false, transactionHash: null };
    }

    if (!this.account || !this.walletClient) {
      throw new Error('AGENT_PRIVATE_KEY not configured');
    }

    this.logger.log(`createIdentity wallet=${wallet}`);
    const transactionHash = await this.walletClient.writeContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'createIdentity',
      args: [wallet],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });

    // The factory sets identityOfWallet in the same tx — read it back for the address.
    const identity = await this.readIdentityOfWallet(wallet);
    if (identity === zeroAddress) {
      throw new Error(`createIdentity confirmed but identityOfWallet still empty for ${wallet}`);
    }
    this.logger.log(`identity created ${identity} txHash=${transactionHash}`);

    return { identity, wallet, created: true, transactionHash };
  }

  /**
   * Link an agent wallet to a person's identity (Model A) AND issue its ENS subname in one call.
   * After this the agent inherits the person's eligibility, and its subname resolves compliance +
   * the ENSIP-25 `agent-registration` record + `agent.reputation` live. Subname issuance is skipped
   * (not fatal) if the registrar/parent aren't configured.
   */
  async linkAgent(params: {
    agentWallet: Address;
    personWallet?: Address;
    personIdentity?: Address;
    label: string;
  }): Promise<LinkAgentResult> {
    if (
      this.identityFactoryAddress === ('0x' as Address) ||
      this.identityFactoryAddress === zeroAddress
    ) {
      throw new Error('IDENTITY_FACTORY_ADDRESS not configured');
    }
    if (!this.account || !this.walletClient) {
      throw new Error('AGENT_PRIVATE_KEY not configured');
    }

    let personIdentity = params.personIdentity;
    if (!personIdentity || personIdentity === zeroAddress) {
      if (!params.personWallet) {
        throw new Error('either personWallet or personIdentity must be provided');
      }
      personIdentity = await this.readIdentityOfWallet(params.personWallet);
    }
    if (personIdentity === zeroAddress) {
      throw new Error('person has no identity — create it first');
    }

    this.logger.log(`linkAgent agent=${params.agentWallet} -> identity=${personIdentity}`);
    const linkTransactionHash = await this.walletClient.writeContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'linkAgent',
      args: [params.agentWallet, personIdentity],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: linkTransactionHash });

    let subname: string | null = null;
    let subnameNode: Hex | null = null;
    let subnameTransactionHash: Hex | null = null;
    const registrarSet =
      this.subnameRegistrarAddress !== ('0x' as Address) &&
      this.subnameRegistrarAddress !== zeroAddress;
    if (registrarSet && this.parentName) {
      const parentNode = namehash(this.parentName);
      subnameTransactionHash = await this.walletClient.writeContract({
        address: this.subnameRegistrarAddress,
        abi: SUBNAME_REGISTRAR_ABI,
        functionName: 'issueSubname',
        args: [parentNode, params.label, params.agentWallet, personIdentity],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: subnameTransactionHash });
      subnameNode = keccak256(
        encodePacked(['bytes32', 'bytes32'], [parentNode, keccak256(toHex(params.label))]),
      );
      subname = `${params.label}.${this.parentName}`;
      this.logger.log(`issued subname ${subname} node=${subnameNode}`);
    } else {
      this.logger.warn('SUBNAME_REGISTRAR_ADDRESS/ENS_PARENT_NAME unset — skipped subname issuance');
    }

    return {
      agentWallet: params.agentWallet,
      personIdentity,
      linkTransactionHash,
      subname,
      subnameNode,
      subnameTransactionHash,
    };
  }

  /** Unlink an agent (blocks only that agent; the person and other agents are untouched). */
  async unlinkAgent(agentWallet: Address): Promise<UnlinkAgentResult> {
    if (
      this.identityFactoryAddress === ('0x' as Address) ||
      this.identityFactoryAddress === zeroAddress
    ) {
      throw new Error('IDENTITY_FACTORY_ADDRESS not configured');
    }
    if (!this.account || !this.walletClient) {
      throw new Error('AGENT_PRIVATE_KEY not configured');
    }
    this.logger.log(`unlinkAgent agent=${agentWallet}`);
    const transactionHash = await this.walletClient.writeContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'unlinkAgent',
      args: [agentWallet],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });
    return { agentWallet, transactionHash };
  }

  private async readIdentityOfWallet(wallet: Address): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.identityFactoryAddress,
      abi: IDENTITY_FACTORY_ABI,
      functionName: 'identityOfWallet',
      args: [wallet],
    })) as Address;
  }
}
