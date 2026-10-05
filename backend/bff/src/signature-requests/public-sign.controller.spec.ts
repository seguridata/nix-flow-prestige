import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, GoneException } from '@nestjs/common';
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

describe('PublicSignController.reject', () => {
  const link = { purpose: 'sign', signatureRequestId: 'sr-1', signerId: 'ana' };

  it('rechazo valido: usa el firmante del enlace, sin tenant, consume el enlace y responde solo {status}', async () => {
    const links = { resolve: vi.fn(async () => link), consume: vi.fn(async () => true) };
    const signatureRequests = {
      reject: vi.fn(async () => ({ id: 'sr-1', signers: [{ signerId: 'otro' }], documentId: 'd' })),
    };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);

    const out = await ctrl.reject('tok', { reason: 'no procede', signerId: 'evil' } as never);

    expect(out).toEqual({ status: 'RECHAZADO' });
    expect(signatureRequests.reject).toHaveBeenCalledWith('sr-1', { signerId: 'ana', reason: 'no procede' });
    expect(links.consume).toHaveBeenCalledWith('tok');
  });

  it('enlace reutilizado => 410 y no rechaza', async () => {
    const links = { resolve: vi.fn(async () => { throw new GoneException('Este enlace ya se utilizó'); }), consume: vi.fn() };
    const signatureRequests = { reject: vi.fn() };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);
    await expect(ctrl.reject('tok', {} as never)).rejects.toBeInstanceOf(GoneException);
    expect(signatureRequests.reject).not.toHaveBeenCalled();
    expect(links.consume).not.toHaveBeenCalled();
  });

  it('enlace expirado => 410', async () => {
    const links = { resolve: vi.fn(async () => { throw new GoneException('Este enlace expiró'); }), consume: vi.fn() };
    const ctrl = new PublicSignController(links as never, { reject: vi.fn() } as never, {} as never, {} as never);
    await expect(ctrl.reject('tok', {} as never)).rejects.toMatchObject({ status: 410 });
  });

  it('firmante ya firmado => 409 y el enlace no se consume', async () => {
    const links = { resolve: vi.fn(async () => link), consume: vi.fn() };
    const signatureRequests = { reject: vi.fn(async () => { throw new ConflictException('Ya firmaste'); }) };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);
    await expect(ctrl.reject('tok', {} as never)).rejects.toBeInstanceOf(ConflictException);
    expect(links.consume).not.toHaveBeenCalled();
  });

  it('enlace sin solicitud o de otro proposito => 400', async () => {
    const links = { resolve: vi.fn(async () => ({ ...link, signatureRequestId: null })), consume: vi.fn() };
    const ctrl = new PublicSignController(links as never, { reject: vi.fn() } as never, {} as never, {} as never);
    await expect(ctrl.reject('tok', {} as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DTO: sanitiza, acota a 500 y rechaza campos extra', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { PublicRejectDto } = await import('./dto');
    const ok = plainToInstance(PublicRejectDto, { reason: '  <b>no</b>\u0000  procede ' });
    expect(ok.reason).toBe('b no /b procede');
    expect(await validate(ok, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const long = plainToInstance(PublicRejectDto, { reason: 'x'.repeat(501) });
    expect(await validate(long)).not.toHaveLength(0);
    const extra = plainToInstance(PublicRejectDto, { signerId: 'evil' });
    expect(await validate(extra, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });
});
