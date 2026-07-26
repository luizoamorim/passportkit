import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { generatePrivateKey } from 'viem/accounts';
import { WorldIdService } from './world-id.service';
import { DemoStateService } from '../demo/demo-state.service';
import type { IssuerSigningService } from '../issuer/issuer-signing.service';

const WALLET = '0x00000000000000000000000000000000000000A1' as const;
const OTHER_WALLET = '0x00000000000000000000000000000000000000B2' as const;
const IDENTITY = '0x00000000000000000000000000000000000000C3' as const;

/** A verifier double: each test sets what developer.world.org would answer. */
function mockVerifier(status: number, body: unknown) {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function makeService(signClaim?: () => Promise<never> | Promise<unknown>) {
  const signing = {
    signClaim: signClaim ?? (() => Promise.reject(new Error('no issuer key configured'))),
  } as unknown as IssuerSigningService;
  const demo = new DemoStateService();
  return { service: new WorldIdService(signing, demo), demo };
}

/** A minimal World ID 3.0-shaped IDKit payload (what selfieCheckLegacy returns). */
function idkitPayload(action: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: '3.0',
    nonce: '0xabc123',
    action,
    environment: 'production',
    responses: [{ identifier: 'face', proof: '0x1', merkle_root: '0x2', nullifier: '0xnull-1' }],
    user_presence_completed: false,
    ...overrides,
  };
}

describe('WorldIdService', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.WORLD_APP_ID = 'app_test';
    process.env.WORLD_RP_ID = 'rp_test';
    process.env.WORLD_RP_SIGNING_KEY = generatePrivateKey();
    process.env.DEMO_MODE = 'true';
    delete process.env.WORLD_ENV;
    delete process.env.WORLD_ACTION;
    delete process.env.WORLD_ACTION_SELFIE;
    delete process.env.WORLD_ACTION_IDENTITY;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('createRequest', () => {
    it('defaults to the production environment — real phones cannot verify staging requests', () => {
      const { service } = makeService();
      expect(service.createRequest('personhood').environment).toBe('production');
    });

    it('honors WORLD_ENV for simulator (staging) and sandbox testing', () => {
      const { service } = makeService();
      process.env.WORLD_ENV = 'sandbox';
      expect(service.createRequest('selfie').environment).toBe('sandbox');
    });

    it('rejects an unknown WORLD_ENV instead of silently mismatching', () => {
      const { service } = makeService();
      process.env.WORLD_ENV = 'prod';
      expect(() => service.createRequest('personhood')).toThrow(/WORLD_ENV must be one of/);
    });

    it('gives each check its own action (own nullifier space)', () => {
      const { service } = makeService();
      expect(service.createRequest('personhood').action).toBe('passportkit-verify');
      expect(service.createRequest('selfie').action).toBe('passportkit-selfie');
      expect(service.createRequest('identity').action).toBe('passportkit-identity');
    });

    it('ships the identity attributes only on the identity check', () => {
      const { service } = makeService();
      expect(service.createRequest('identity').identity_attributes).toEqual([
        { type: 'document_type', value: 'passport' },
        { type: 'minimum_age', value: 18 },
      ]);
      expect(service.createRequest('selfie').identity_attributes).toBeUndefined();
    });

    it('signs a fresh rp_context nonce per request', () => {
      const { service } = makeService();
      const a = service.createRequest('personhood');
      const b = service.createRequest('personhood');
      expect(a.rp_context.nonce).not.toBe(b.rp_context.nonce);
      expect(a.rp_context.rp_id).toBe('rp_test');
    });
  });

  describe('verifyAndPrepareClaim', () => {
    it('accepts a verified proof and records the check in demo mode', async () => {
      const { service, demo } = makeService();
      global.fetch = mockVerifier(200, { success: true, nullifier: '0xnull-1' });

      const result = await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie'));

      expect(result).toMatchObject({ mode: 'mock', verified: true, check: 'selfie' });
      expect(demo.checkFor(WALLET, 'selfie')).toBe('VERIFIED');
      expect(demo.checkFor(WALLET, 'personhood')).toBe('UNVERIFIED');
    });

    it('forwards the IDKit payload to the verifier byte-for-byte', async () => {
      const { service } = makeService();
      const verifier = mockVerifier(200, { success: true, nullifier: '0xnull-1' });
      global.fetch = verifier;
      const payload = idkitPayload('passportkit-selfie');

      await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', payload);

      const [url, init] = (verifier as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://developer.world.org/api/v4/verify/rp_test');
      expect(JSON.parse(init.body as string)).toEqual(payload);
    });

    it('surfaces the verifier error code and detail instead of a generic failure', async () => {
      const { service } = makeService();
      global.fetch = mockVerifier(400, {
        success: false,
        code: 'all_verifications_failed',
        detail: 'All proof verifications failed.',
        results: [{ identifier: 'face', success: false, code: 'verification_error', detail: 'On-chain proof verification failed.' }],
      });

      await expect(
        service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie')),
      ).rejects.toThrow(/all_verifications_failed.*verification_error/s);
    });

    it('rejects a proof bound to another action before calling the verifier', async () => {
      const { service } = makeService();
      const verifier = mockVerifier(200, { success: true });
      global.fetch = verifier;

      await expect(
        service.verifyAndPrepareClaim(WALLET, IDENTITY, 'identity', {
          ...idkitPayload('passportkit-selfie'),
          identity_attested: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(verifier).not.toHaveBeenCalled();
    });

    it('rejects an identity check whose attributes were not attested', async () => {
      const { service } = makeService();
      const verifier = mockVerifier(200, { success: true });
      global.fetch = verifier;

      await expect(
        service.verifyAndPrepareClaim(WALLET, IDENTITY, 'identity', idkitPayload('passportkit-identity')),
      ).rejects.toThrow(/identity_attested/);
      expect(verifier).not.toHaveBeenCalled();
    });

    it('accepts an identity check that attests the requested attributes', async () => {
      const { service } = makeService();
      global.fetch = mockVerifier(200, { success: true, nullifier: '0xnull-9' });

      const result = await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'identity', {
        ...idkitPayload('passportkit-identity'),
        protocol_version: '4.0',
        identity_attested: true,
      });
      expect(result).toMatchObject({ verified: true, check: 'identity' });
    });

    it('blocks the same nullifier from verifying a second wallet, but stays idempotent for the first', async () => {
      const { service } = makeService();
      global.fetch = mockVerifier(200, { success: true, nullifier: '0xNULL-1' });

      await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie'));
      // Same wallet retries (e.g. after a UI hiccup): allowed.
      await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie'));
      // Another wallet replays the same World ID: refused.
      await expect(
        service.verifyAndPrepareClaim(OTHER_WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie')),
      ).rejects.toThrow(/different wallet/);
    });

    it('signs the check-specific claim topic when the issuer is configured', async () => {
      const signClaim = jest.fn(async () => ({
        topic: '1', issuer: '0x1', signature: '0x2', data: '0x3',
      }));
      const { service } = makeService(signClaim as never);
      global.fetch = mockVerifier(200, { success: true, nullifier: '0xnull-1' });

      const result = await service.verifyAndPrepareClaim(WALLET, IDENTITY, 'selfie', idkitPayload('passportkit-selfie'));

      expect(result.mode).toBe('onchain');
      const arg = (signClaim.mock.calls[0] as unknown[])[0] as { topic: bigint; expiresAt: bigint };
      const { CLAIM_TOPICS } = await import('../issuer/claim-topics');
      expect(arg.topic).toBe(CLAIM_TOPICS.SELFIE_VERIFIED);
      // Selfie Check credentials expire in 90 days, not a year.
      const ninetyDays = BigInt(Math.floor(Date.now() / 1000) + 90 * 86400);
      expect(arg.expiresAt <= ninetyDays + 60n && arg.expiresAt >= ninetyDays - 60n).toBe(true);
    });
  });
});
