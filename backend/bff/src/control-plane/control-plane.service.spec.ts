/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneService, isPlatformAdmin } from './control-plane.service';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { SloService } from './slo.service';

const tenants = [
  { id: 'id-acme', slug: 'acme' },
  { id: 'id-seg', slug: 'seguridata' },
];
const prisma = {
  tenant: {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) =>
      tenants.find((t) => t.id === where.id || t.slug === where.slug) ?? null,
  },
} as never;

describe('ControlPlaneService.assertOwnTenant', () => {
  const svc = new ControlPlaneService(prisma);

  it("un admin del tenant 'seguridata' YA NO administra otros tenants", async () => {
    await expect(svc.assertOwnTenant('acme', { tenantId: 'seguridata', roles: ['admin'] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('un admin administra su propio tenant (id o slug)', async () => {
    await expect(svc.assertOwnTenant('acme', { tenantId: 'acme', roles: ['admin'] })).resolves.toBeUndefined();
    await expect(svc.assertOwnTenant('id-acme', { tenantId: 'acme', roles: ['admin'] })).resolves.toBeUndefined();
  });

  it('platform_admin administra cualquier tenant', async () => {
    await expect(
      svc.assertOwnTenant('acme', { tenantId: 'seguridata', roles: ['platform_admin'] }),
    ).resolves.toBeUndefined();
    expect(isPlatformAdmin({ roles: ['admin'] })).toBe(false);
  });
});

describe('SloService.snapshot por tenant', () => {
  it('acota los conteos al tenant del usuario', async () => {
    const wheres: unknown[] = [];
    const count = vi.fn(async ({ where }: { where: unknown }) => {
      wheres.push(where);
      return 0;
    });
    const p = {
      signatureRequest: { count },
      $queryRaw: vi.fn(async (q: { values?: unknown[] }) => {
        wheres.push(q.values ?? []);
        return [{ avg_seconds: null }];
      }),
      workflowRun: { count },
      notificationOutbox: { count },
      webhookDelivery: { count },
      humanTask: { count },
    } as never;
    await new SloService(p).snapshot('acme');
    expect(wheres.every((w) => JSON.stringify(w).includes('acme'))).toBe(true);
  });
});

describe('ControlPlaneService - ciclo de vida del tenant', () => {
  const mkPrisma = () => {
    const tx = {
      tenant: { create: vi.fn(async ({ data }: any) => ({ id: 'id-new', ...data })), update: vi.fn(async () => ({})) },
      policy: { create: vi.fn(async () => ({})) },
      catalogEntry: { create: vi.fn(async () => ({})) },
      webhookSubscription: { updateMany: vi.fn(async () => ({ count: 2 })) },
      webhookDelivery: { updateMany: vi.fn(async () => ({ count: 5 })) },
    };
    const prisma: any = {
      tenant: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.slug === 'acme' || where.id === 'id-acme' ? { id: 'id-acme', slug: 'acme', active: true } : null,
        ),
        update: vi.fn(async () => ({})),
        upsert: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    return { prisma, tx };
  };

  it.each(['ab', 'Acme', 'a_b', '-abc', 'abc-', 'platform', 'admin', 'x'.repeat(41), 'ñandú'])(
    'createTenant rechaza el slug %s',
    async (slug) => {
      const { prisma } = mkPrisma();
      await expect(new ControlPlaneService(prisma).createTenant({ slug, name: 'X' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('createTenant crea el tenant con políticas y catálogos por defecto en una transacción', async () => {
    const { prisma, tx } = mkPrisma();
    const t = await new ControlPlaneService(prisma).createTenant({ slug: 'nuevo-1', name: 'Nuevo' });
    expect(t.slug).toBe('nuevo-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const pol = tx.policy.create.mock.calls[0][0].data;
    expect(pol.key).toBe('signature.policy');
    expect(pol.tenantId).toBe('id-new');
    expect(pol.value.allowedMethods).not.toContain('BIOMETRICA');
    expect(tx.catalogEntry.create).toHaveBeenCalledTimes(3);
  });

  it('createTenant es idempotente: si el slug existe no crea nada', async () => {
    const { prisma } = mkPrisma();
    const t = await new ControlPlaneService(prisma).createTenant({ slug: 'acme', name: 'Acme' });
    expect(t.id).toBe('id-acme');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('suspendTenant desactiva el tenant y webhooks, cancela entregas pendientes (sin borrar) y audita', async () => {
    const { prisma, tx } = mkPrisma();
    const audit = { append: vi.fn(async () => ({})) };
    const r = await new ControlPlaneService(prisma, audit as any).suspendTenant('acme', 'root-op');
    expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 'id-acme' }, data: { active: false } });
    expect(tx.webhookSubscription.updateMany.mock.calls[0][0].data).toEqual({ active: false });
    const del = tx.webhookDelivery.updateMany.mock.calls[0][0];
    expect(del.data.status).toBe('DLQ');
    expect(del.where.status.in).toEqual(['PENDIENTE', 'FALLIDO']);
    expect(r).toMatchObject({ webhooksPaused: 2, deliveriesCancelled: 5, active: false });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TENANT_SUSPENDED', tenantId: 'acme' }));
  });

  it('reactivateTenant solo reactiva el tenant: no toca webhooks', async () => {
    const { prisma, tx } = mkPrisma();
    const audit = { append: vi.fn(async () => ({})) };
    await new ControlPlaneService(prisma, audit as any).reactivateTenant('acme');
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 'id-acme' }, data: { active: true } });
    expect(tx.webhookSubscription.updateMany).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TENANT_REACTIVATED' }));
  });

  it('suspendTenant de un tenant inexistente: 404', async () => {
    const { prisma } = mkPrisma();
    await expect(new ControlPlaneService(prisma).suspendTenant('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('onModuleInit respeta DEFAULT_TENANT_SLUG (vacío = no crea tenant)', async () => {
    const { prisma } = mkPrisma();
    const prev = process.env.DEFAULT_TENANT_SLUG;
    try {
      process.env.DEFAULT_TENANT_SLUG = '';
      await new ControlPlaneService(prisma).onModuleInit();
      expect(prisma.tenant.upsert).not.toHaveBeenCalled();
      process.env.DEFAULT_TENANT_SLUG = 'otro';
      await new ControlPlaneService(prisma).onModuleInit();
      expect(prisma.tenant.upsert.mock.calls[0][0].where).toEqual({ slug: 'otro' });
      delete process.env.DEFAULT_TENANT_SLUG;
      await new ControlPlaneService(prisma).onModuleInit();
      expect(prisma.tenant.upsert.mock.calls[1][0].where).toEqual({ slug: 'seguridata' });
    } finally {
      if (prev === undefined) delete process.env.DEFAULT_TENANT_SLUG;
      else process.env.DEFAULT_TENANT_SLUG = prev;
    }
  });
});

describe('TenantContextGuard - tenant suspendido', () => {
  it('un usuario con membresía en un tenant inactivo recibe 403', async () => {
    const request = { user: { actorId: 'maria', sub: 's', tenantId: 'acme', roles: [] }, headers: {} };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    const reflector = { getAllAndOverride: () => false } as any;
    const rows = [{ tenantId: 't1', tenant: { id: 't1', slug: 'acme', active: false } }];
    const prisma = { tenantMembership: { findMany: async () => rows } } as any;
    await expect(new TenantContextGuard(reflector, prisma).canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
