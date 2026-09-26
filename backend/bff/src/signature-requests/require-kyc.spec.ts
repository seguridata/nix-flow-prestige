import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SignatureRequestsService } from './signature-requests.service';
import type { PrismaService } from '../prisma/prisma.service';

// Relativos al reloj real (el gate usa `Date.now()`, no un reloj inyectado).
const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * 24 * 3600_000);
const ONE_DAY_AGO = new Date(Date.now() - 24 * 3600_000);
const REQUEST_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * Mismo patrón que require-passkey.spec.ts: `signing.sign()` devuelve
 * `pending: true` para no arrastrar la cascada de post-proceso — el gate de
 * kycPolicy corre ANTES de esa rama.
 */
function makeService(opts: { kycPolicy: 'NONE' | 'ONCE' | 'EVERY_SIGN'; onboardingCases: Record<string, unknown>[] }) {
  const request = {
    id: 'sr-1',
    tenantId: 'seguridata',
    status: 'PENDIENTE',
    methods: ['ACCEPT'],
    order: 'PARALELO',
    requirePasskey: false,
    kycPolicy: opts.kycPolicy,
    documentId: 'doc-1',
    createdAt: REQUEST_CREATED_AT,
    requestedBy: null as string | null,
    document: { hash: 'a'.repeat(64), objectKey: 'k', enc: {}, locked: false, presentedObjectKey: null },
    signers: [
      {
        id: 'signer-row-1',
        signerId: 'maria',
        email: 'maria@seguridata.mx',
        status: 'PENDIENTE',
        sortOrder: 0,
        delegatedTo: null,
      },
    ],
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
    consentAcceptance: { upsert: async () => ({}) },
    onboardingCase: {
      findFirst: async ({ where }: { where: { updatedAt: { gte: Date } } }) =>
        opts.onboardingCases.find((c) => (c.updatedAt as Date).getTime() >= where.updatedAt.gte.getTime()) ?? null,
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  } as unknown as PrismaService;
  const signing = {
    sign: vi.fn(async () => ({
      algorithm: 'x',
      provider: 'x',
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
    undefined as never,
  );
  return { svc, signing };
}

describe('SignatureRequestsService.sign — gate kycPolicy', () => {
  it('NONE no exige nada', async () => {
    const { svc, signing } = makeService({ kycPolicy: 'NONE', onboardingCases: [] });
    await svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true });
    expect(signing.sign).toHaveBeenCalled();
  });

  it('ONCE rechaza sin ningún alta HABILITADO', async () => {
    const { svc } = makeService({ kycPolicy: 'ONCE', onboardingCases: [] });
    await expect(
      svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ONCE acepta un alta HABILITADO dentro de los últimos 90 días', async () => {
    const { svc, signing } = makeService({
      kycPolicy: 'ONCE',
      onboardingCases: [{ updatedAt: ONE_DAY_AGO }],
    });
    await svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true });
    expect(signing.sign).toHaveBeenCalled();
  });

  it('ONCE rechaza un alta HABILITADO de hace más de 90 días', async () => {
    const { svc } = makeService({
      kycPolicy: 'ONCE',
      onboardingCases: [{ updatedAt: NINETY_ONE_DAYS_AGO }],
    });
    await expect(
      svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('EVERY_SIGN rechaza un alta HABILITADO anterior a la creación de la solicitud', async () => {
    const { svc } = makeService({
      kycPolicy: 'EVERY_SIGN',
      onboardingCases: [{ updatedAt: new Date(REQUEST_CREATED_AT.getTime() - 1000) }],
    });
    await expect(
      svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('EVERY_SIGN acepta un alta HABILITADO posterior a la creación de la solicitud', async () => {
    const { svc, signing } = makeService({
      kycPolicy: 'EVERY_SIGN',
      onboardingCases: [{ updatedAt: new Date(REQUEST_CREATED_AT.getTime() + 1000) }],
    });
    await svc.sign('sr-1', { signerId: 'maria', method: 'ACCEPT', consentAccepted: true });
    expect(signing.sign).toHaveBeenCalled();
  });
});
