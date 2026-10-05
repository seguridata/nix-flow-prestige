import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SignatureRequestsService } from './signature-requests.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignaturePolicyService } from '../signing/signature-policy';

function makeService(templates: Record<string, Record<string, unknown>>) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    envelopeTemplate: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const t = templates[where.id];
        return t && t.tenantId === where.tenantId ? t : null;
      },
    },
    document: {
      findFirst: async () => ({ id: 'doc-1', tenantId: 'seguridata', caseId: 'case-1' }),
    },
    tenantMembership: { findMany: async () => [] },
    signatureRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'sr-1', ...data, signers: [] };
        created.push(row);
        return row;
      },
      findFirst: async () => created[0] ?? null,
    },
  } as unknown as PrismaService;

  const policyService = {
    resolve: async () => ({
      version: 0,
      source: 'default' as const,
      allowedMethods: ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'] as const,
      defaultSlaHours: 72,
      defaultOrder: 'SECUENCIAL' as const,
      requireTimestamp: true,
      requireConsent: true,
      certificateProfile: 'x',
    }),
    enforce: (
      policy: { defaultOrder: 'SECUENCIAL' | 'PARALELO'; defaultSlaHours: number },
      req: { order?: 'SECUENCIAL' | 'PARALELO'; slaHours?: number },
    ) => ({
      order: req.order ?? policy.defaultOrder,
      slaHours: req.slaHours ?? policy.defaultSlaHours,
    }),
  } as unknown as SignaturePolicyService;

  const workflow = { startInstance: async () => undefined };
  const collab = { audit: async () => undefined, notify: async () => undefined };
  const mail = { sendInvite: async () => undefined, sendInvites: async () => undefined };

  const documents = { freeze: vi.fn(async () => ({ locked: true })) };
  const svc = new SignatureRequestsService(
    prisma,
    undefined as never,
    undefined as never,
    workflow as never,
    undefined as never,
    undefined as never,
    undefined as never,
    collab as never,
    mail as never,
    policyService,
    undefined as never,
    documents as never,
  );
  return { svc, created, documents };
}

describe('SignatureRequestsService.create — plantillas', () => {
  it('usa allowedMethods/order/kycPolicy/requirePasskey de la plantilla cuando el cuerpo no los trae', async () => {
    const { svc, created } = makeService({
      't1': {
        tenantId: 'seguridata',
        order: 'PARALELO',
        kycPolicy: 'ONCE',
        allowedMethods: ['ACCEPT', 'PASSKEY'],
        requirePasskey: true,
        slaHours: 48,
      },
    });
    await svc.create({
      documentId: 'doc-1',
      templateId: 't1',
      tenantId: 'seguridata',
      signers: [{ signerId: 'ana@seguridata.mx' }],
    });
    expect(created[0]).toMatchObject({
      methods: ['ACCEPT', 'PASSKEY'],
      order: 'PARALELO',
      kycPolicy: 'ONCE',
      requirePasskey: true,
      slaHours: 48,
    });
  });

  it('un override explícito en el cuerpo gana sobre la plantilla', async () => {
    const { svc, created } = makeService({
      't1': {
        tenantId: 'seguridata',
        order: 'PARALELO',
        kycPolicy: 'ONCE',
        allowedMethods: ['ACCEPT'],
        requirePasskey: true,
        slaHours: 48,
      },
    });
    await svc.create({
      documentId: 'doc-1',
      templateId: 't1',
      methods: ['DIGITAL'],
      order: 'SECUENCIAL',
      requirePasskey: false,
      tenantId: 'seguridata',
      signers: [{ signerId: 'ana@seguridata.mx' }],
    });
    expect(created[0]).toMatchObject({
      methods: ['DIGITAL'],
      order: 'SECUENCIAL',
      requirePasskey: false,
    });
  });

  it('rechaza un templateId que no existe o es de otro tenant', async () => {
    const { svc } = makeService({ 't1': { tenantId: 'otro-tenant' } });
    await expect(
      svc.create({
        documentId: 'doc-1',
        templateId: 't1',
        tenantId: 'seguridata',
        signers: [{ signerId: 'ana@seguridata.mx' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin plantilla ni methods explícitos, rechaza (nada que autorizar)', async () => {
    const { svc } = makeService({});
    await expect(
      svc.create({
        documentId: 'doc-1',
        tenantId: 'seguridata',
        signers: [{ signerId: 'ana@seguridata.mx' }],
      }),
    ).rejects.toThrow(/al menos un método/);
  });
});
