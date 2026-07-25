import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { WorldService } from './world.service';

const MOCK_PROOF = {
  merkle_root: '0xroot',
  nullifier_hash: '0xnull',
  proof: '0xproof',
  verification_level: 'device',
};

describe('WorldService', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    delete process.env.WORLD_APP_ID;
    delete process.env.WORLD_ACTION;
    delete process.env.DEMO_MODE;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it('DEMO_MODE fallback passes as a labeled mock when no World app is configured', async () => {
    process.env.DEMO_MODE = 'true';
    const service = new WorldService();

    const result = await service.verify('selfie', MOCK_PROOF);

    expect(result.ok).toBe(true);
    expect(result.mock).toBe(true);
    expect(result.nullifierHash).toBe('0xnull');
  });

  it('rejects an unconfigured app outside DEMO_MODE (no silent bypass)', async () => {
    const service = new WorldService();
    await expect(service.verify('document', MOCK_PROOF)).rejects.toThrow('WORLD_APP_ID');
  });
});
