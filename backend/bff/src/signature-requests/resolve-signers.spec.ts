import { describe, expect, it } from 'vitest';
import type { SignerRole } from '@prisma/client';

import { SignatureRequestsService } from './signature-requests.service';
import type { PrismaService } from '../prisma/prisma.service';

type Signer = { signerId: string; name?: string; email?: string; role?: SignerRole };

/**
 * `resolveSigners` sólo toca `prisma.tenantMembership.findMany`; el resto de
 * dependencias no se ejercitan y pueden ir como `undefined`.
 */
function makeService(members: { userId: string; name: string | null; email: string | null }[]) {
  const prisma = {
    tenantMembership: { findMany: async () => members },
  } as unknown as PrismaService;
  const svc = new SignatureRequestsService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return (tenantId: string, signers: Signer[]) =>
    (svc as unknown as { resolveSigners: (t: string, s: Signer[]) => Promise<Signer[]> }).resolveSigners(
      tenantId,
      signers,
    );
}

const MEMBERS = [
  { userId: 'maria', name: 'María González', email: 'maria@seguridata.mx' },
  { userId: 'carlos', name: 'Carlos Ramírez', email: 'carlos@seguridata.mx' },
];

describe('SignatureRequestsService.resolveSigners', () => {
  it('adopta el userId canónico cuando el correo entrante coincide con un miembro', async () => {
    const resolve = makeService(MEMBERS);
    const [s] = await resolve('seguridata', [
      { signerId: 'maria@seguridata.mx', name: 'Maria', email: 'maria@seguridata.mx', role: 'FIRMANTE' },
    ]);
    expect(s.signerId).toBe('maria');
    expect(s.email).toBe('maria@seguridata.mx');
  });

  it('reescribe el signerId cuando llega como correo pero el campo email va vacío', async () => {
    const resolve = makeService(MEMBERS);
    const [s] = await resolve('seguridata', [{ signerId: 'CARLOS@SEGURIDATA.MX', name: 'C' }]);
    expect(s.signerId).toBe('carlos');
    expect(s.email).toBe('carlos@seguridata.mx');
    expect(s.name).toBe('C'); // respeta el nombre tecleado
  });

  it('acepta el username directo (match por userId, case-insensitive)', async () => {
    const resolve = makeService(MEMBERS);
    const [s] = await resolve('seguridata', [{ signerId: 'Maria' }]);
    expect(s.signerId).toBe('maria');
    expect(s.name).toBe('María González'); // completa el nombre que faltaba
  });

  it('deja intacto al firmante externo que no está en el directorio', async () => {
    const resolve = makeService(MEMBERS);
    const input: Signer = { signerId: 'ext@example.com', name: 'Externa', email: 'ext@example.com' };
    const [s] = await resolve('seguridata', [input]);
    expect(s).toEqual(input);
  });
});
