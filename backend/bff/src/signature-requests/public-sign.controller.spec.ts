import { describe, expect, it, vi } from 'vitest';
import { PublicSignController } from './public-sign.controller';

describe('PublicSignController.sign - respuesta publica', () => {
  it('devuelve solo {status, signedAt, requestStatus} aunque el servicio entregue mas', async () => {
    const signedAt = new Date('2026-01-01T00:00:00Z');
    const links = {
      resolve: vi.fn(async () => ({ purpose: 'sign', signatureRequestId: 'sr-1', signerId: 'ana' })),
      consume: vi.fn(async () => undefined),
    };
    const signatureRequests = {
      sign: vi.fn(async () => ({
        status: 'FIRMADO',
        signedAt,
        requestStatus: 'COMPLETADA',
        // Cualquier campo extra (PDF, otros firmantes) NO debe filtrarse al exterior.
        signedPdf: Buffer.from('%PDF'),
        signers: [{ signerId: 'otro' }],
      })),
    };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);

    const out = await ctrl.sign('tok', { method: 'ACCEPT', consentAccepted: true } as never, '1.2.3.4', 'ua', undefined);

    expect(out).toEqual({ status: 'FIRMADO', signedAt, requestStatus: 'COMPLETADA' });
    expect(links.consume).toHaveBeenCalledWith('tok');
  });
});

describe('PublicSignController.passkeyFinish', () => {
  it('pasa expectedSignerId del enlace y la respuesta tipada a ceremony.finish', async () => {
    const links = { resolve: vi.fn(async () => ({ purpose: 'sign', signatureRequestId: 'sr-1', signerId: 'ana' })) };
    const passkeys = { finish: vi.fn(async () => ({ ok: true })) };
    const ctrl = new PublicSignController(links as never, {} as never, {} as never, passkeys as never);
    const response = { id: 'cred', rawId: 'cred', type: 'public-key', response: {}, clientExtensionResults: {} };

    await ctrl.passkeyFinish('tok', { assertionId: 'as-1', response } as never);

    expect(passkeys.finish).toHaveBeenCalledWith({ assertionId: 'as-1', response, expectedSignerId: 'ana' });
  });
});
