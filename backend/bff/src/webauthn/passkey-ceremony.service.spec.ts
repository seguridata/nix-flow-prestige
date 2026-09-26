import { describe, expect, it, vi } from 'vitest';
import { PasskeyCeremonyService } from './passkey-ceremony.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CollaborationService } from '../collaboration/collaboration.service';
import type { WebauthnConfig } from './webauthn.config';

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'chal-abc' })),
  verifyAuthenticationResponse: vi.fn(async ({ expectedChallenge }: { expectedChallenge: string }) => {
    if (expectedChallenge !== 'chal-abc') return { verified: false };
    return { verified: true, authenticationInfo: { newCounter: 6 } };
  }),
}));

function makeService() {
  const assertions = new Map<string, Record<string, unknown>>();
  const credentials = new Map<string, Record<string, unknown>>([
    [
      Buffer.from('cred-1').toString('base64url'),
      {
        id: 'row-1',
        tenantId: 'seguridata',
        credentialId: Buffer.from('cred-1'),
        publicKey: Buffer.from([1]),
        counter: 5n,
        transports: [],
      },
    ],
  ]);
  const audits: unknown[] = [];
  let seq = 0;

  const prisma = {
    signatureRequest: {
      findUnique: async () => ({
        id: 'sr-1',
        tenantId: 'seguridata',
        document: { hash: 'a'.repeat(64) },
      }),
    },
    passkeyCredential: {
      findMany: async () => [...credentials.values()],
      findUnique: async ({ where }: { where: { credentialId: Buffer } }) => {
        const key = where.credentialId.toString('base64url');
        return credentials.get(key) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { counter: number } }) => {
        const row = [...credentials.values()].find((c) => c.id === where.id)!;
        row.counter = BigInt(data.counter);
        return row;
      },
    },
    passkeyAssertion: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `assert-${seq++}`;
        const row = { id, verifiedAt: null, consumedAt: null, ...data };
        assertions.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => assertions.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => assertions.get(where.id)!,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = assertions.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = assertions.get(where.id as string);
        if (!row) return { count: 0 };
        const okTenant = row.tenantId === where.tenantId;
        const okRequest = row.signatureRequestId === where.signatureRequestId;
        const okSigner = row.signerId === where.signerId;
        const okVerified = row.verifiedAt !== null;
        const okUnconsumed = row.consumedAt === null;
        const okFresh = (row.expiresAt as Date).getTime() > Date.now();
        if (!(okTenant && okRequest && okSigner && okVerified && okUnconsumed && okFresh)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaService;

  const collab = { audit: async (e: unknown) => audits.push(e) } as unknown as CollaborationService;
  const config = { rpID: 'localhost', rpName: 'Prestige', origin: 'http://localhost:3001' } as WebauthnConfig;
  return { svc: new PasskeyCeremonyService(prisma, collab, config), audits };
}

const RESPONSE = { id: Buffer.from('cred-1').toString('base64url') } as never;

describe('PasskeyCeremonyService', () => {
  it('begin → finish → consume: camino feliz, y consumir dos veces falla', async () => {
    const { svc, audits } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await svc.finish({ assertionId, response: RESPONSE });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'PASSKEY_ASSERTED' });

    const consumed = await svc.consume({
      assertionId,
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      signerId: 'maria',
    });
    expect(consumed.credentialId).toBe(Buffer.from('cred-1').toString('base64url'));

    await expect(
      svc.consume({ assertionId, tenantId: 'seguridata', signatureRequestId: 'sr-1', signerId: 'maria' }),
    ).rejects.toThrow();
  });

  it('consume rechaza una aserción de otro firmante o de otra solicitud', async () => {
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await svc.finish({ assertionId, response: RESPONSE });

    await expect(
      svc.consume({ assertionId, tenantId: 'seguridata', signatureRequestId: 'sr-1', signerId: 'carlos' }),
    ).rejects.toThrow();
    await expect(
      svc.consume({ assertionId, tenantId: 'seguridata', signatureRequestId: 'otra-sr', signerId: 'maria' }),
    ).rejects.toThrow();
  });

  it('finish rechaza si el contador no avanza (replay/clon)', async () => {
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    // La primera corrida sube el contador de la credencial a 6 (mock fijo).
    await svc.finish({ assertionId, response: RESPONSE });
    // Segunda aserción, mismo credential: el contador ya está en 6, y el mock
    // de verificación siempre devuelve newCounter=6 -> 6 <= 6, debe rechazar.
    const { assertionId: secondId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await expect(svc.finish({ assertionId: secondId, response: RESPONSE })).rejects.toThrow();
  });
});
