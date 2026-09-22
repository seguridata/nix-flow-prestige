import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * M15 — control plane. CRUD de tenants, membresías, políticas y catálogos.
 * Keycloak sigue siendo la fuente de identidad; esto añade la capa de negocio.
 */
@Injectable()
export class ControlPlaneService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.tenant.upsert({
      where: { slug: 'seguridata' },
      create: { slug: 'seguridata', name: 'SeguriData' },
      update: {},
    });
  }

  // ---- Tenants ----
  listTenants() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  createTenant(body: { slug: string; name: string }) {
    return this.prisma.tenant.create({ data: { slug: body.slug, name: body.name } });
  }

  async updateTenant(id: string, body: { name?: string; active?: boolean }) {
    await this.getTenant(id);
    return this.prisma.tenant.update({ where: { id }, data: body });
  }

  private async getTenant(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException(`Tenant ${id} no encontrado`);
    return t;
  }

  private async resolveTenantId(idOrSlug: string): Promise<string> {
    const t =
      (await this.prisma.tenant.findUnique({ where: { id: idOrSlug } })) ??
      (await this.prisma.tenant.findUnique({ where: { slug: idOrSlug } }));
    if (!t) throw new NotFoundException(`Tenant ${idOrSlug} no encontrado`);
    return t.id;
  }

  // ---- Membresías ----
  async listMembers(tenantIdOrSlug: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    return this.prisma.tenantMembership.findMany({ where: { tenantId }, orderBy: { userId: 'asc' } });
  }

  async upsertMember(
    tenantIdOrSlug: string,
    body: { userId: string; name?: string; email?: string; roles?: string[]; active?: boolean },
  ) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    return this.prisma.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId, userId: body.userId } },
      create: {
        tenantId,
        userId: body.userId,
        name: body.name,
        email: body.email,
        roles: body.roles ?? [],
        active: body.active ?? true,
      },
      update: { name: body.name, email: body.email, roles: body.roles, active: body.active },
    });
  }

  async removeMember(tenantIdOrSlug: string, userId: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    await this.prisma.tenantMembership.deleteMany({ where: { tenantId, userId } });
    return { ok: true };
  }

  /** Usado por otros servicios: ¿este `userId` es miembro activo del tenant? */
  async isMember(tenantIdOrSlug: string, userId: string): Promise<boolean> {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug).catch(() => null);
    if (!tenantId) return false;
    const m = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    return Boolean(m?.active);
  }

  // ---- Políticas ----
  async listPolicies(tenantIdOrSlug: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    return this.prisma.policy.findMany({ where: { tenantId }, orderBy: { key: 'asc' } });
  }

  async setPolicy(tenantIdOrSlug: string, key: string, value: unknown, updatedBy?: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    const existing = await this.prisma.policy.findUnique({ where: { tenantId_key: { tenantId, key } } });
    return this.prisma.policy.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: value as Prisma.InputJsonValue, updatedBy },
      update: { value: value as Prisma.InputJsonValue, version: (existing?.version ?? 0) + 1, updatedBy },
    });
  }

  async getPolicy(tenantIdOrSlug: string, key: string): Promise<unknown> {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug).catch(() => null);
    if (!tenantId) return null;
    const p = await this.prisma.policy.findUnique({ where: { tenantId_key: { tenantId, key } } });
    return p?.value ?? null;
  }

  // ---- Catálogos ----
  async listCatalog(tenantIdOrSlug: string, kind?: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    return this.prisma.catalogEntry.findMany({
      where: { tenantId, kind: kind || undefined },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async upsertCatalog(
    tenantIdOrSlug: string,
    body: { kind: string; key: string; label: string; meta?: unknown; sortOrder?: number; active?: boolean },
  ) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    return this.prisma.catalogEntry.upsert({
      where: { tenantId_kind_key: { tenantId, kind: body.kind, key: body.key } },
      create: {
        tenantId,
        kind: body.kind,
        key: body.key,
        label: body.label,
        meta: (body.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
      update: {
        label: body.label,
        meta: (body.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        sortOrder: body.sortOrder,
        active: body.active,
      },
    });
  }

  async removeCatalog(tenantIdOrSlug: string, kind: string, key: string) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    await this.prisma.catalogEntry.deleteMany({ where: { tenantId, kind, key } });
    return { ok: true };
  }
}
