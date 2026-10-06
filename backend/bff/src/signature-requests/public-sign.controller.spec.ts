import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, GoneException, NotFoundException } from '@nestjs/common';
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

describe('PublicSignController.resolve — allowedMethodsNow', () => {
  it('oculta los métodos visuales si ya hay firma DIGITAL en el PDF', async () => {
    const links = {
      resolve: vi.fn(async () => ({ purpose: 'sign', signatureRequestId: 'sr-1', signerId: 'segundo', expiresAt: new Date() })),
    };
    const prisma = {
      signatureRequest: {
        findUnique: vi.fn(async () => ({
          documentId: 'd',
          document: { filename: 'x.pdf' },
          methods: ['DIGITAL', 'AUTOGRAFA', 'ACCEPT'],
          order: 'SECUENCIAL',
          status: 'EN_FIRMA',
          signers: [
            { signerId: 'primero', status: 'FIRMADO', usedMethod: 'DIGITAL' },
            { signerId: 'segundo', status: 'PENDIENTE' },
          ],
        })),
      },
    };
    const ctrl = new PublicSignController(links as never, {} as never, prisma as never, {} as never);
    const out = await ctrl.resolve('tok');
    expect(out.methods).toEqual(['DIGITAL', 'AUTOGRAFA', 'ACCEPT']);
    expect(out.allowedMethodsNow).toEqual(['DIGITAL', 'ACCEPT']);
  });
});

describe('PublicSignController - bloqueo por token', () => {
  const link = { purpose: 'sign', signatureRequestId: 'sr-1', signerId: 'ana' };

  it('una aserción de passkey rechazada suma un fallo al enlace y relanza', async () => {
    const links = { resolve: vi.fn(async () => link), recordFailure: vi.fn(async () => undefined) };
    const passkeys = { finish: vi.fn(async () => { throw new BadRequestException('aserción inválida'); }) };
    const ctrl = new PublicSignController(links as never, {} as never, {} as never, passkeys as never);
    await expect(ctrl.passkeyFinish('tok', { assertionId: 'a', response: {} } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(links.recordFailure).toHaveBeenCalledWith('tok');
  });

  it('una firma rechazada suma un fallo y NO consume el enlace', async () => {
    const links = { resolve: vi.fn(async () => link), recordFailure: vi.fn(async () => undefined), consume: vi.fn() };
    const signatureRequests = { sign: vi.fn(async () => { throw new BadRequestException('consentimiento requerido'); }) };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);
    await expect(ctrl.sign('tok', { method: 'ACCEPT' } as never, '1.1.1.1', 'ua', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(links.recordFailure).toHaveBeenCalledWith('tok');
    expect(links.consume).not.toHaveBeenCalled();
  });

  it('un conflicto de estado (409) no cuenta como intento fallido', async () => {
    const links = { resolve: vi.fn(async () => link), recordFailure: vi.fn(), consume: vi.fn() };
    const signatureRequests = { sign: vi.fn(async () => { throw new ConflictException('ya firmó'); }) };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, {} as never, {} as never);
    await expect(ctrl.sign('tok', { method: 'ACCEPT' } as never, '1.1.1.1', 'ua', undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(links.recordFailure).not.toHaveBeenCalled();
  });
});

describe('PublicSignController.download', () => {
  function res() {
    const headers: Record<string, unknown> = {};
    const r = {
      status: vi.fn(() => r),
      setHeader: vi.fn((k: string, v: unknown) => { headers[k] = v; return r; }),
      end: vi.fn(),
    };
    return { r, headers };
  }
  const link = { purpose: 'download', signatureRequestId: 'sr-1', signerId: 'ana' };
  const completed = { id: 'sr-1', status: 'COMPLETADA', documentId: 'd-1', document: { tenantId: 't1' } };

  it('entrega la copia firmada como adjunto, audita y NO consume el enlace', async () => {
    const links = { resolve: vi.fn(async () => link), consume: vi.fn() };
    const prisma = { signatureRequest: { findUnique: vi.fn(async () => completed) } };
    const documents = { getPresented: vi.fn(async () => ({ bytes: Buffer.from('%PDF-firmado'), filename: 'contrato.pdf' })) };
    const signatureRequests = { recordSignedCopyDownload: vi.fn(async () => undefined) };
    const ctrl = new PublicSignController(links as never, signatureRequests as never, prisma as never, {} as never, documents as never);
    const { r, headers } = res();

    await ctrl.download('tok', r as never, '9.9.9.9', 'ua');

    expect(links.resolve).toHaveBeenCalledWith('tok', 'download');
    expect(documents.getPresented).toHaveBeenCalledWith('d-1', 't1');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(String(headers['Content-Disposition'])).toContain("attachment; filename*=UTF-8''contrato-firmado.pdf");
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(r.end).toHaveBeenCalledWith(Buffer.from('%PDF-firmado'));
    expect(signatureRequests.recordSignedCopyDownload).toHaveBeenCalledWith('sr-1', { signerId: 'ana', ip: '9.9.9.9', userAgent: 'ua' });
    expect(links.consume).not.toHaveBeenCalled();
  });

  it('solicitud aún no COMPLETADA => 404 y no lee el PDF', async () => {
    const links = { resolve: vi.fn(async () => link) };
    const prisma = { signatureRequest: { findUnique: vi.fn(async () => ({ ...completed, status: 'EN_FIRMA' })) } };
    const documents = { getPresented: vi.fn() };
    const ctrl = new PublicSignController(links as never, {} as never, prisma as never, {} as never, documents as never);
    await expect(ctrl.download('tok', res().r as never, 'ip')).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.getPresented).not.toHaveBeenCalled();
  });
});
