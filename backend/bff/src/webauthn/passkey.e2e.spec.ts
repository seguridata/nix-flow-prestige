import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasskeyCeremonyService } from './passkey-ceremony.service';
import { PasskeyRegistrationService } from './passkey-registration.service';
import { WebauthnConfig } from './webauthn.config';
import { FLAG_UP, TestAuthenticator } from './test-authenticator';
import type { PrismaService } from '../prisma/prisma.service';
import type { CollaborationService } from '../collaboration/collaboration.service';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

// Sin mocks de @simplewebauthn/server: la verificación criptográfica es real.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function setup() {
  const config = new WebauthnConfig();
  const credentials: Row[] = [];
  const assertions: Row[] = [];
  const regChallenges: Row[] = [];
  let seq = 0;
  const sameBuf = (a: Buffer, b: Buffer) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

  const prisma = {
    signatureRequest: {
      findUnique: async () => ({ id: 'sr-1', tenantId: 't1', document: { hash: 'a'.repeat(64) } }),
    },
    passkeyCredential: {
      findMany: async ({ where }: Row) =>
        credentials.filter(
          (c) =>
            c.tenantId === where.tenantId &&
            (where.OR
              ? where.OR.some(
                  (o: Row) => (o.userId && c.userId === o.userId) || (o.signerId && c.signerId === o.signerId),
                )
              : c.userId === where.userId),
        ),
      findUnique: async ({ where }: Row) =>
        credentials.find((c) => sameBuf(c.credentialId, where.credentialId)) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: `cred-${++seq}`, signerId: null, createdAt: new Date(), ...data };
        credentials.push(row);
        return row;
      },
      // Síncrono entre comprobar y escribir: atómico como el UPDATE condicional de Postgres.
      updateMany: async ({ where, data }: Row) => {
        const row = credentials.find((c) => c.id === where.id);
        if (!row || !(row.counter < where.counter.lt)) return { count: 0 };
        row.counter = data.counter;
        return { count: 1 };
      },
    },
    passkeyAssertion: {
      create: async ({ data }: Row) => {
        const row = { id: `as-${++seq}`, verifiedAt: null, consumedAt: null, credentialId: null, ...data };
        assertions.push(row);
        return row;
      },
      findUnique: async ({ where }: Row) => assertions.find((a) => a.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: Row) => assertions.find((a) => a.id === where.id)!,
      updateMany: async ({ where, data }: Row) => {
        const row = assertions.find(
          (a) =>
            a.id === where.id &&
            (where.verifiedAt === null
              ? a.verifiedAt === null
              : where.verifiedAt?.not === null
                ? a.verifiedAt !== null
                : true) &&
            (where.consumedAt === null ? a.consumedAt === null : true) &&
            (!where.tenantId || a.tenantId === where.tenantId) &&
            (!where.signerId || a.signerId === where.signerId) &&
            (!where.signatureRequestId || a.signatureRequestId === where.signatureRequestId),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    passkeyRegistrationChallenge: {
      create: async ({ data }: Row) => {
        const row = { id: `rc-${++seq}`, createdAt: new Date(), ...data };
        regChallenges.push(row);
        return row;
      },
      findFirst: async ({ where }: Row) =>
        [...regChallenges].reverse().find((c) => c.tenantId === where.tenantId && c.userId === where.userId) ??
        null,
      delete: async ({ where }: Row) => {
        regChallenges.splice(
          regChallenges.findIndex((c) => c.id === where.id),
          1,
        );
      },
    },
  } as unknown as PrismaService;

  const collab = { audit: vi.fn(async () => undefined) } as unknown as CollaborationService;
  const registration = new PasskeyRegistrationService(prisma, config);
  const ceremony = new PasskeyCeremonyService(prisma, collab, config);
  return { config, credentials, assertions, registration, ceremony };
}

const user = (actorId: string): AuthenticatedUser =>
  ({ actorId, tenantId: 't1', name: actorId }) as unknown as AuthenticatedUser;

async function enroll(s: ReturnType<typeof setup>, actorId: string, device = new TestAuthenticator()) {
  const u = user(actorId);
  const opts = await s.registration.beginRegistration(u);
  const res = device.register({ challenge: opts.challenge, origin: s.config.origin, rpID: s.config.rpID });
  await s.registration.finishRegistration(u, res as never);
  return device;
}

async function begin(s: ReturnType<typeof setup>, signerId: string) {
  const { assertionId, options } = await s.ceremony.begin({ signatureRequestId: 'sr-1', signerId });
  return { assertionId, challenge: options.challenge };
}

describe('Passkey con autenticador software (verificación criptográfica real)', () => {
  let s: ReturnType<typeof setup>;
  let maria: TestAuthenticator;
  beforeEach(async () => {
    s = setup();
    maria = await enroll(s, 'maria');
  });

  const sign = (
    d: TestAuthenticator,
    challenge: string,
    over: Partial<Parameters<TestAuthenticator['assert']>[0]> = {},
  ) => d.assert({ challenge, origin: s.config.origin, rpID: s.config.rpID, signCount: 1, ...over }) as never;

  it('1. registro válido guarda credencial con counter y transports', () => {
    expect(s.credentials).toHaveLength(1);
    const c = s.credentials[0];
    expect(c.userId).toBe('maria');
    expect(c.counter).toBe(0n);
    expect(c.transports).toEqual(['internal']);
    expect(Buffer.from(c.credentialId).equals(maria.credentialId)).toBe(true);
  });

  it('2. begin->finish ok, el contador sube y la aserción se consume una sola vez', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId, response: sign(maria, challenge, { signCount: 7 }) }),
    ).resolves.toEqual({ ok: true });
    expect(s.credentials[0].counter).toBe(7n);
    const p = { assertionId, tenantId: 't1', signatureRequestId: 'sr-1', signerId: 'maria' };
    await expect(s.ceremony.consume(p)).resolves.toEqual({ credentialId: maria.id });
    await expect(s.ceremony.consume(p)).rejects.toMatchObject({ status: 409 });
  });

  it('3. replay de la misma aserción es rechazado', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    const res = sign(maria, challenge);
    await s.ceremony.finish({ assertionId, response: res });
    await expect(s.ceremony.finish({ assertionId, response: res })).rejects.toMatchObject({ status: 409 });
    // Una aserción NUEVA con el mismo signCount también cae (contador no avanza).
    const again = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId: again.assertionId, response: sign(maria, again.challenge, { signCount: 1 }) }),
    ).rejects.toThrow();
  });

  it('4. contador que no avanza (igual o menor) es rechazado', async () => {
    s.credentials[0].counter = 5n;
    for (const signCount of [5, 3]) {
      const { assertionId, challenge } = await begin(s, 'maria');
      await expect(
        s.ceremony.finish({ assertionId, response: sign(maria, challenge, { signCount }) }),
      ).rejects.toThrow();
    }
    expect(s.credentials[0].counter).toBe(5n);
  });

  it('5a. firma alterada (un byte) es rechazada', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    const res = sign(maria, challenge) as any;
    const sig = Buffer.from(res.response.signature, 'base64url');
    sig[sig.length - 1] ^= 0x01;
    res.response.signature = sig.toString('base64url');
    await expect(s.ceremony.finish({ assertionId, response: res })).rejects.toThrow();
    expect(s.credentials[0].counter).toBe(0n);
  });

  it('5b. challenge de otra ceremonia es rechazado', async () => {
    const a = await begin(s, 'maria');
    const b = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId: a.assertionId, response: sign(maria, b.challenge) }),
    ).rejects.toThrow();
  });

  it('5c. origin distinto es rechazado', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId, response: sign(maria, challenge, { origin: 'https://evil.example' }) }),
    ).rejects.toThrow();
  });

  it('5d. rpId distinto es rechazado', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId, response: sign(maria, challenge, { rpID: 'evil.example' }) }),
    ).rejects.toThrow();
  });

  it('5e. type webauthn.create en lugar de webauthn.get es rechazado', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId, response: sign(maria, challenge, { type: 'webauthn.create' }) }),
    ).rejects.toThrow();
  });

  it('6. credencial de otro usuario del mismo tenant no satisface al firmante (403)', async () => {
    const carlos = await enroll(s, 'carlos');
    const { assertionId, challenge } = await begin(s, 'maria');
    const err = await s.ceremony.finish({ assertionId, response: sign(carlos, challenge) }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(s.credentials.find((c) => c.userId === 'carlos')!.counter).toBe(0n);
  });

  it('7. aserción sin flag UV es rechazada (userVerification required)', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    await expect(
      s.ceremony.finish({ assertionId, response: sign(maria, challenge, { flags: FLAG_UP }) }),
    ).rejects.toThrow();
    expect(s.credentials[0].counter).toBe(0n);
  });

  it('8. dos finish simultáneos con la misma aserción: exactamente uno gana', async () => {
    const { assertionId, challenge } = await begin(s, 'maria');
    const res = sign(maria, challenge);
    const results = await Promise.allSettled([
      s.ceremony.finish({ assertionId, response: res }),
      s.ceremony.finish({ assertionId, response: res }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(s.credentials[0].counter).toBe(1n);
  });
});
