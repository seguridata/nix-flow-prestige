import { describe, expect, it, vi } from 'vitest';
import { PasskeySignerAdapter } from './passkey.adapter';
import type { PasskeyCeremonyService } from '../webauthn/passkey-ceremony.service';

function command(overrides: Partial<Parameters<PasskeySignerAdapter['sign']>[0]> = {}) {
  return {
    method: 'PASSKEY' as const,
    signerId: 'maria',
    documentId: 'doc-1',
    tenantId: 'seguridata',
    signatureRequestId: 'sr-1',
    documentHash: 'a'.repeat(64),
    pdfBytes: Buffer.from('x'),
    ...overrides,
  };
}

describe('PasskeySignerAdapter', () => {
  it('rechaza sin passkeyAssertionId', async () => {
    const ceremony = { consume: vi.fn() } as unknown as PasskeyCeremonyService;
    const adapter = new PasskeySignerAdapter(ceremony);
    await expect(adapter.sign(command())).rejects.toThrow();
    expect(ceremony.consume).not.toHaveBeenCalled();
  });

  it('gasta la aserción y firma el hash del documento', async () => {
    const ceremony = {
      consume: vi.fn(async () => ({ credentialId: 'cred-abc' })),
    } as unknown as PasskeyCeremonyService;
    const adapter = new PasskeySignerAdapter(ceremony);
    const result = await adapter.sign(command({ passkeyAssertionId: 'assert-1' }));
    expect(ceremony.consume).toHaveBeenCalledWith({
      assertionId: 'assert-1',
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      signerId: 'maria',
    });
    expect(result.signatureHash).toBe('a'.repeat(64));
  });
});
