import type { ClaimTopicName } from '../issuer/claim-topics';

/**
 * The three World ID checks PassportKit can request. Each check maps to its own
 * Developer Portal action (its own nullifier space) and its own claim topic.
 */
export const WORLD_CHECKS = ['personhood', 'selfie', 'identity'] as const;
export type WorldCheck = (typeof WORLD_CHECKS)[number];

/** IDKit environments. Staging pairs with the simulator, sandbox with the sandbox World ID app. */
export const WORLD_ENVIRONMENTS = ['production', 'staging', 'sandbox'] as const;
export type WorldEnvironment = (typeof WORLD_ENVIRONMENTS)[number];

/** Mirrors @worldcoin/idkit-core's IdentityAttribute (the api does not depend on the widget package). */
export type IdentityAttribute =
  | { type: 'document_type'; value: 'passport' | 'eid' | 'mnc' }
  | { type: 'document_number'; value: string }
  | { type: 'issuing_country'; value: string }
  | { type: 'full_name'; value: string }
  | { type: 'minimum_age'; value: number }
  | { type: 'nationality'; value: string };

export type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

export type WorldRequestPayload = {
  check: WorldCheck;
  app_id: string;
  action: string;
  environment: WorldEnvironment;
  rp_context: RpContext;
  /** Only present for the identity check: the attributes the widget must request. */
  identity_attributes?: IdentityAttribute[];
};

export const CHECK_TOPICS: Record<WorldCheck, ClaimTopicName> = {
  personhood: 'PROOF_OF_PERSONHOOD',
  selfie: 'SELFIE_VERIFIED',
  identity: 'IDENTITY_ATTESTED',
};
