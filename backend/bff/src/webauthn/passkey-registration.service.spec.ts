import { describe, expect, it, vi } from 'vitest';
import { PasskeyRegistrationService } from './passkey-registration.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WebauthnConfig } from './webauthn.config';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'chal-123' })),
  verifyRegistrationResponse: vi.fn(async ({ expectedChallenge }: { expectedChallenge: string }) => {
    if (expectedChallenge !== 'chal-123') return { verified: false };
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: Buffer.from('cred-1').toString('base64url'),
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
        },
      },
    };
  }),
}));

const USER: AuthenticatedUser = {
  sub: 'u1',
  actorId: 'maria',
  tenantId: 'seguridata',
  roles: [],
  raw: {},
};

function makeService() {
  const challenges: { id: string; userId: string; challenge: string; expiresAt: Date; createdAt: Date }[] = [];
  const credentials: { credentialId: Buffer }[] = [];
  const prisma = {
    passkeyCredential: {
      findMany: async () => [],
      // Simula la restricción única de `credentialId` (Prisma P2002): el
      // índice real es la defensa contra el duplicado, no lógica de la app.
      create: async ({ data }: { data: { credentialId: Buffer } & Record<string, unknown> }) => {
        if (credentials.some((c) => c.credentialId.equals(data.credentialId))) {
          throw Object.assign(new Error('Unique constraint failed on the fields: (`credentialId`)'), {
            code: 'P2002',
          });
        }
        credentials.push({ credentialId: data.credentialId });
        return { id: `cred-row-${credentials.length}`, transports: data.transports, createdAt: new Date() };
      },
    },
    passkeyRegistrationChallenge: {
      create: async ({ data }: { data: { userId: string; challenge: string; expiresAt: Date } }) => {
        const row = { id: `ch${challenges.length}`, createdAt: new Date(), ...data };
        challenges.push(row);
        return row;
      },
      findFirst: async () => challenges.at(-1) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const i = challenges.findIndex((c) => c.id === where.id);
        if (i >= 0) challenges.splice(i, 1);
      },
    },
  } as unknown as PrismaService;
  const config = { rpID: 'localhost', rpName: 'Prestige', origin: 'http://localhost:3001' } as WebauthnConfig;
  return { svc: new PasskeyRegistrationService(prisma, config), credentials };
}

describe('PasskeyRegistrationService', () => {
  it('begin persiste el challenge que devuelve la librería', async () => {
    const { svc } = makeService();
    const options = await svc.beginRegistration(USER);
    expect(options.challenge).toBe('chal-123');
  });

  it('finish verifica contra el challenge persistido y crea la credencial', async () => {
    const { svc, credentials } = makeService();
    await svc.beginRegistration(USER);
    const cred = await svc.finishRegistration(USER, {} as never);
    expect(credentials).toHaveLength(1);
    expect(cred).toMatchObject({ id: 'cred-row-1' });
  });

  it('finish sin un begin previo rechaza', async () => {
    const { svc } = makeService();
    await expect(svc.finishRegistration(USER, {} as never)).rejects.toThrow();
  });

  it('registrar el mismo autenticador dos veces rechaza (credentialId único)', async () => {
    const { svc } = makeService();
    await svc.beginRegistration(USER);
    await svc.finishRegistration(USER, {} as never);
    // Segundo registro del MISMO autenticador (el mock de verifyRegistrationResponse
    // siempre devuelve `credential.id` = 'cred-1' para esta respuesta fija).
    await svc.beginRegistration(USER);
    await expect(svc.finishRegistration(USER, {} as never)).rejects.toThrow(/P2002|Unique constraint/);
  });
});
