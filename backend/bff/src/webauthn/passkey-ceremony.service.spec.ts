import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PasskeyCeremonyService } from './passkey-ceremony.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CollaborationService } from '../collaboration/collaboration.service';
import type { WebauthnConfig } from './webauthn.config';

const mockCounter = vi.hoisted(() => ({ value: 6 }));

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'chal-abc' })),
  verifyAuthenticationResponse: vi.fn(async ({ expectedChallenge }: { expectedChallenge: string }) => {
    if (expectedChallenge !== 'chal-abc') return { verified: false };
    return { verified: true, authenticationInfo: { newCounter: mockCounter.value } };
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
        userId: 'maria',
        signerId: null,
        credentialId: Buffer.from('cred-1'),
        publicKey: Buffer.from([1]),
        counter: 5n,
        transports: [],
      },
    ],
    [
      Buffer.from('cred-2').toString('base64url'),
      {
        id: 'row-2',
        tenantId: 'seguridata',
        userId: 'carlos',
        signerId: null,
        credentialId: Buffer.from('cred-2'),
        publicKey: Buffer.from([2]),
        counter: 5n,
        transports: [],
      },
    ],
  ]);
  const audits: unknown[] = [];
  const findManyArgs: unknown[] = [];
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
      findMany: async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        findManyArgs.push(where);
        const ids = where.OR.flatMap((o) => Object.values(o));
        return [...credentials.values()].filter((c) => ids.includes(c.userId as string));
      },
      findUnique: async ({ where }: { where: { credentialId: Buffer } }) => {
        const key = where.credentialId.toString('base64url');
        return credentials.get(key) ?? null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; counter: { lt: bigint } };
        data: { counter: bigint };
      }) => {
        const row = [...credentials.values()].find((c) => c.id === where.id)!;
        if (!((row.counter as bigint) < where.counter.lt)) return { count: 0 };
        row.counter = data.counter;
        return { count: 1 };
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
        if ('tenantId' in where === false) {
          if (row.verifiedAt !== null || row.consumedAt !== null) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }
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
  return { svc: new PasskeyCeremonyService(prisma, collab, config), audits, findManyArgs, credentials };
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
    mockCounter.value = 6;
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await svc.finish({ assertionId, response: RESPONSE });
    // Segunda aserción, mismo credential: contador guardado 6, newCounter 6.
    const { assertionId: secondId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await expect(svc.finish({ assertionId: secondId, response: RESPONSE })).rejects.toThrow();
  });

  it('rechaza newCounter=0 cuando el contador guardado es mayor que 0', async () => {
    mockCounter.value = 0;
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await expect(svc.finish({ assertionId, response: RESPONSE })).rejects.toMatchObject({
      response: { error: 'PASSKEY_REPLAY' },
    });
    mockCounter.value = 6;
  });

  it('passkey de otro usuario del mismo tenant es rechazada', async () => {
    mockCounter.value = 6;
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    const carlos = { id: Buffer.from('cred-2').toString('base64url') } as never;
    await expect(svc.finish({ assertionId, response: carlos })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('begin construye allowCredentials solo con las credenciales del firmante (userId)', async () => {
    const { svc, findManyArgs } = makeService();
    await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    expect(findManyArgs[0]).toMatchObject({ OR: [{ userId: 'maria' }, { signerId: 'maria' }] });
    const mod = await import('@simplewebauthn/server');
    const call = vi.mocked(mod.generateAuthenticationOptions).mock.calls.at(-1)![0];
    expect(call.userVerification).toBe('required');
    expect(call.allowCredentials).toHaveLength(1);
  });

  it('finish autenticado rechaza una aserción emitida a otro firmante', async () => {
    mockCounter.value = 6;
    const { svc } = makeService();
    const { assertionId } = await svc.begin({ signatureRequestId: 'sr-1', signerId: 'maria' });
    await expect(
      svc.finish({ assertionId, response: RESPONSE, expectedSignerId: 'carlos' }),
    ).rejects.toThrow();
  });
});
