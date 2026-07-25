import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { WorldService } from './world.service';

const V4_RESULT = {
  protocol_version: '4.0',
  responses: [
    { identifier: 'selfie', nullifier: '0xnull-selfie', issuer_schema_id: 11 },
  ],
};

const SESSION_RESULT = {
  protocol_version: '4.0',
  responses: [{ identifier: 'passport', session_nullifier: ['0xsession-null', '0xaction'] }],
};

describe('WorldService (v4)', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    delete process.env.WORLD_APP_ID;
    delete process.env.WORLD_RP_ID;
    delete process.env.WORLD_RP_SIGNING_KEY;
    delete process.env.WORLD_ACTION;
    delete process.env.DEMO_MODE;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it('DEMO_MODE buildRequest returns a labeled mock rp_context when unconfigured', () => {
    process.env.DEMO_MODE = 'true';
    const service = new WorldService();
    const cfg = service.buildRequest('selfie');
    expect(cfg.mock).toBe(true);
    expect(cfg.rp_context.rp_id).toBe('rp_demo');
  });

  it('DEMO_MODE verifyResult extracts the nullifier and flags it mock', () => {
    process.env.DEMO_MODE = 'true';
    const service = new WorldService();
    const r = service.verifyResult('selfie', V4_RESULT);
    expect(r.ok).toBe(true);
    expect(r.mock).toBe(true);
    expect(r.nullifierHash).toBe('0xnull-selfie');
  });

  it('extracts a session_nullifier when present', () => {
    process.env.DEMO_MODE = 'true';
    const service = new WorldService();
    const r = service.verifyResult('document', SESSION_RESULT);
    expect(r.nullifierHash).toBe('0xsession-null');
  });

  it('rejects an unconfigured app outside DEMO_MODE (no silent bypass)', () => {
    const service = new WorldService();
    expect(() => service.buildRequest('document')).toThrow('not configured');
    expect(() => service.verifyResult('document', V4_RESULT)).toThrow('not configured');
  });
});
