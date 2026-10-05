/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

function svc() {
  const prisma = {
    signatureRequest: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === 'srA' && where.tenantId === 'A' ? { id: 'srA' } : null,
      ),
    },
    document: { findFirst: vi.fn(async () => null) },
    onboardingCase: { findFirst: vi.fn(async () => null) },
    processAuditEvent: { findMany: vi.fn(async () => []) },
  };
  const s = new ProcessService(prisma as any, {} as any);
  return { prisma, s };
}

describe('process audit - aislamiento por tenant', () => {
  it('listAudit con solicitud de otro tenant -> 404', async () => {
    const { s, prisma } = svc();
    await expect(s.listAudit({ signatureRequestId: 'srA' }, 'B')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.processAuditEvent.findMany).not.toHaveBeenCalled();
  });

  it('listAudit propio filtra por tenantId', async () => {
    const { s, prisma } = svc();
    await s.listAudit({ signatureRequestId: 'srA' }, 'A');
    expect(prisma.processAuditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'A' }) }),
    );
  });

  it('verify: admin, acotado al tenant del usuario', async () => {
    const verify = vi.fn(async () => ({ ok: true }));
    const { s } = svc();
    const ctrl = new ProcessController(s, { verify } as any);
    await ctrl.verifyAudit({}, { tenantId: 'A' } as AuthenticatedUser);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A' }));
    await expect(
      ctrl.verifyAudit({ signatureRequestId: 'srA' }, { tenantId: 'B' } as AuthenticatedUser),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(Reflect.getMetadata(ROLES_KEY, ProcessController.prototype.verifyAudit)).toEqual(['admin']);
  });

  it('escritura de process-definitions exige admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProcessController.prototype.save)).toEqual(['admin']);
  });
});
