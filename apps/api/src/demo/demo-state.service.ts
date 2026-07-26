import { Injectable } from '@nestjs/common';
import { getAddress, keccak256, toHex, type Address } from 'viem';
import type { WorldCheck } from '../world-id/world-id.types';

export type DemoPersonhoodStatus = 'UNVERIFIED' | 'VERIFIED';

/**
 * Local-only state used when contracts and credentials have not been deployed.
 * It is intentionally in-memory: nothing here is an on-chain attestation.
 */
@Injectable()
export class DemoStateService {
  private readonly identities = new Map<string, Address>();
  private readonly checks = new Map<string, Set<WorldCheck>>();

  get enabled(): boolean {
    return process.env.DEMO_MODE === 'true';
  }

  identityFor(wallet: Address): Address | null {
    return this.identities.get(wallet.toLowerCase()) ?? null;
  }

  createIdentity(wallet: Address): Address {
    const key = wallet.toLowerCase();
    const existing = this.identities.get(key);
    if (existing) return existing;

    // A deterministic display-only address; it is never deployed or submitted to a chain.
    const hash = keccak256(toHex(`passportkit-demo:${key}`));
    const identity = getAddress(`0x${hash.slice(-40)}`) as Address;
    this.identities.set(key, identity);
    return identity;
  }

  checkFor(wallet: Address, check: WorldCheck): DemoPersonhoodStatus {
    return this.checks.get(wallet.toLowerCase())?.has(check) ? 'VERIFIED' : 'UNVERIFIED';
  }

  markCheckVerified(wallet: Address, check: WorldCheck): void {
    const key = wallet.toLowerCase();
    const set = this.checks.get(key) ?? new Set<WorldCheck>();
    set.add(check);
    this.checks.set(key, set);
  }

  personhoodFor(wallet: Address): DemoPersonhoodStatus {
    return this.checkFor(wallet, 'personhood');
  }

  markPersonhoodVerified(wallet: Address): void {
    this.markCheckVerified(wallet, 'personhood');
  }
}
