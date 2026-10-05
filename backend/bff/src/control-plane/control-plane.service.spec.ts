import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneService, isPlatformAdmin } from './control-plane.service';
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
