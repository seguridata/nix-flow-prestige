import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SignatureRequestsService } from './signature-requests.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PasskeyCeremonyService } from '../webauthn/passkey-ceremony.service';

/**
 * Ejercita el gate de `requirePasskey` sin arrastrar la cascada de
 * post-proceso de `sign()` (realtime/evidence/workflow/mail cuando la firma
 * queda COMPLETADA): `signing.sign()` devuelve `pending: true`, así que el
 * método toma la rama corta de "firma asíncrona en curso" — la misma que ya
 * usan los métodos 2FA/biométricos reales — y solo hacen falta `collab`
 * (audit/notify) además del propio `signing` para terminar sin lanzar. El
 * gate en sí corre ANTES de esa rama, así que sigue probando lo que importa.
 */
function makeService(opts: { requirePasskey: boolean; consumeOk: boolean }) {
  const request = {
    id: 'sr-1',
    tenantId: 'seguridata',
    status: 'PENDIENTE',
    methods: ['ACCEPT', 'PASSKEY'],
    order: 'PARALELO',
    requirePasskey: opts.requirePasskey,
    documentId: 'doc-1',
    requestedBy: null as string | null,
    // FREEZE obligatorio: el canónico va congelado y su hash coincide con el storage.
    document: { hash: createHash('sha256').update('%PDF-1.4').digest('hex'), objectKey: 'k', enc: {}, locked: true, presentedObjectKey: null },
    signers: [{ id: 'signer-row-1', signerId: 'maria', status: 'PENDIENTE', sortOrder: 0, delegatedTo: null }],
  };
  const prisma = {
    signatureRequest: {
      findUnique: async () => request,
      findFirst: async () => request,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...request, ...data }),
    },
    signer: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    signatureField: { findFirst: async () => null },
    consentAcceptance: { findUnique: async () => null, create: async () => ({}) },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  } as unknown as PrismaService;
  const passkeys = {
    consume: vi.fn(async () => {
      if (!opts.consumeOk) throw new Error('aserción inválida');
      return { credentialId: 'cred-1' };
    }),
  } as unknown as PasskeyCeremonyService;
  const signing = {
    sign: vi.fn(async () => ({
      algorithm: 'x',
      provider: 'x',
      // No-hex a propósito: si algún día alguien cambia este fake y lo
      // vuelve un hex64 real, el código de producción intentaría pedir un
      // sello RFC 3161 real (red) desde este test unitario.
      signatureHash: 'sin-formato-hex',
      pending: true,
      pendingRef: 'pending-test',
    })),
  };
  const storage = { getObject: async () => Buffer.from('%PDF-1.4') };
  const collab = { audit: vi.fn(async () => ({})), notify: vi.fn(async () => ({})) };
  const svc = new SignatureRequestsService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
    signing as never,
    undefined as never,
    storage as never,
    collab as never,
    undefined as never,
    undefined as never,
    passkeys,
  );
  return { svc, passkeys, signing };
}

describe('SignatureRequestsService.sign — gate requirePasskey', () => {
  it('rechaza ACCEPT sin passkeyAssertionId cuando requirePasskey=true', async () => {
    const { svc, passkeys } = makeService({ requirePasskey: true, consumeOk: true });
    await expect(
      svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(passkeys.consume).not.toHaveBeenCalled();
  });

  it('deja pasar ACCEPT con una aserción válida cuando requirePasskey=true', async () => {
    const { svc, passkeys, signing } = makeService({ requirePasskey: true, consumeOk: true });
    await svc.sign('sr-1', {
      signerId: 'maria',
      method: 'ACCEPT',
      consentAccepted: true,
      passkeyAssertionId: 'assert-1',
    });
    expect(passkeys.consume).toHaveBeenCalledWith({
      assertionId: 'assert-1',
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      signerId: 'maria',
    });
    expect(signing.sign).toHaveBeenCalled();
  });

  it('no exige passkey cuando requirePasskey=false', async () => {
    const { svc, passkeys, signing } = makeService({ requirePasskey: false, consumeOk: true });
    await svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true });
    expect(passkeys.consume).not.toHaveBeenCalled();
    expect(signing.sign).toHaveBeenCalled();
  });

  it('rechaza con la excepción del servicio de ceremonia si la aserción es inválida', async () => {
    const { svc } = makeService({ requirePasskey: true, consumeOk: false });
    await expect(
      svc.sign('sr-1', {
        signerId: 'maria',
        method: 'ACCEPT',
        consentAccepted: true,
        passkeyAssertionId: 'assert-1',
      }),
    ).rejects.toThrow('aserción inválida');
  });
});
