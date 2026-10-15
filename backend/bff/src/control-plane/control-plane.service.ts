import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';

/** Operador de plataforma: rol de realm explícito, nunca inferido del tenant. */
export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const isPlatformAdmin = (u: { roles?: string[] }) => (u.roles ?? []).includes(PLATFORM_ADMIN_ROLE);

/** Slug de tenant: minúsculas, números y guiones; 3-40 caracteres; sin guiones en los extremos. */
export const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/** Slugs que chocan con rutas, identidades de sistema o el operador de plataforma. */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  'platform', 'admin', 'administrator', 'root', 'system', 'sistema', 'api', 'www', 'app', 'auth', 'login', 'keycloak',
  'public', 'default', 'null', 'undefined', 'test', 'internal', 'support', 'status', 'health', 'metrics', 'static',
]);

export function assertValidTenantSlug(slug: string): void {
  if (typeof slug !== 'string' || !TENANT_SLUG_RE.test(slug)) {
    throw new BadRequestException(
      'slug inválido: usa minúsculas, números y guiones (3-40 caracteres, sin guiones al inicio ni al final)',
    );
  }
  if (RESERVED_TENANT_SLUGS.has(slug)) throw new BadRequestException(`slug reservado: ${slug}`);
}

/**
 * Políticas por defecto de un tenant nuevo (valores seguros). La clave de firma
 * es la misma que resuelve SignaturePolicyService ('signature.policy'): se
 * excluye BIOMETRICA y PASSKEY hasta que el tenant las habilite explícitamente.
 */
export const DEFAULT_TENANT_POLICIES: ReadonlyArray<{ key: string; value: Prisma.InputJsonValue }> = [
  {
    key: 'signature.policy',
    value: {
      allowedMethods: ['DIGITAL', 'AUTOGRAFA', 'ACCEPT'],
      defaultSlaHours: 72,
      defaultOrder: 'SECUENCIAL',
      requireTimestamp: true,
      requireConsent: true,
      certificateProfile: 'prestige-firmantes-v1',
    },
  },
];

/** Catálogos por defecto de un tenant nuevo. */
export const DEFAULT_TENANT_CATALOGS: ReadonlyArray<{ kind: string; key: string; label: string; sortOrder: number }> = [
  { kind: 'signature-method', key: 'DIGITAL', label: 'Firma digital', sortOrder: 10 },
  { kind: 'signature-method', key: 'AUTOGRAFA', label: 'Firma autógrafa', sortOrder: 20 },
  { kind: 'signature-method', key: 'ACCEPT', label: 'Aceptación', sortOrder: 30 },
];

/**
 * M15 — control plane. CRUD de tenants, membresías, políticas y catálogos.
 * Keycloak sigue siendo la fuente de identidad; esto añade la capa de negocio.
 *
 * CICLO DE VIDA DE UN TENANT (diseño propuesto; solo los pasos 1 y 2 están implementados):
 *   1. Alta (createTenant): slug validado + políticas y catálogos por defecto, en una transacción.
 *   2. Suspensión (suspendTenant): el guard bloquea el acceso, se pausan los webhooks y se cancelan
 *      sus entregas pendientes (DLQ, reencolables). Reversible con reactivateTenant (los webhooks
 *      NO se reactivan solos: es decisión del tenant).
 *   3. Exportación (NO implementada): job asíncrono que empaqueta documentos, evidencias, auditoría
 *      y manifiestos del tenant en un paquete firmado y cifrado con una clave propia del tenant.
 *   4. Ventana de retención (NO implementada): el tenant permanece suspendido N días (legal/contractual)
 *      con derecho a reactivar o exportar; solo lectura para el operador.
 *   5. Purga (NO implementada): job por lotes e idempotente, con doble confirmación de platform_admin,
 *      que borra filas por tenantId y objetos de storage, y aplica cripto-borrado (destruir la clave
 *      de cifrado por tenant) para invalidar copias y backups. La cadena de auditoría global solo
 *      conserva un evento tombstone (hash), nunca contenido. Los workflows de Temporal se cancelan de
 *      forma explícita antes de la purga, nunca en la suspensión.
 */
@Injectable()
export class ControlPlaneService implements OnModuleInit {
  private readonly log = new Logger(ControlPlaneService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditChainService,
  ) {}

  /**
   * Tenant semilla. `DEFAULT_TENANT_SLUG` (default 'seguridata'); vacío = no crear
   * ninguno (despliegues donde los tenants se aprovisionan solo por el control plane).
   */
  async onModuleInit() {
    const slug = (process.env.DEFAULT_TENANT_SLUG ?? 'seguridata').trim();
    if (!slug) return;
    await this.prisma.tenant.upsert({
      where: { slug },
      create: { slug, name: slug === 'seguridata' ? 'SeguriData' : slug },
      update: {},
    });
  }

  // ---- Tenants ----
  listTenants() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Idempotente por slug: si ya existe lo devuelve sin tocar sus políticas ni catálogos. */
  async createTenant(body: { slug: string; name: string }) {
    assertValidTenantSlug(body.slug);
    const existing = await this.prisma.tenant.findUnique({ where: { slug: body.slug } });
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { slug: body.slug, name: body.name } });
        for (const p of DEFAULT_TENANT_POLICIES) {
          await tx.policy.create({
            data: { tenantId: tenant.id, key: p.key, value: p.value, updatedBy: 'system:tenant-bootstrap' },
          });
        }
        for (const c of DEFAULT_TENANT_CATALOGS) {
          await tx.catalogEntry.create({ data: { tenantId: tenant.id, ...c } });
        }
        return tenant;
      });
    } catch (e) {
      // Carrera entre réplicas: otra creó el mismo slug entre el find y el create.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const t = await this.prisma.tenant.findUnique({ where: { slug: body.slug } });
        if (t) return t;
      }
      throw e;
    }
  }

  async updateTenant(id: string, body: { name?: string; active?: boolean }) {
    await this.getTenant(id);
    // El flag active pasa por suspend/reactivate para no dejar webhooks vivos de un tenant inactivo.
    const { active, ...rest } = body;
    if (active === false) await this.suspendTenant(id);
    else if (active === true) await this.reactivateTenant(id);
    if (rest.name === undefined) return this.getTenant(id);
    return this.prisma.tenant.update({ where: { id }, data: { name: rest.name } });
  }

  /**
   * Suspende un tenant: el TenantContextGuard ya rechaza a los tenants inactivos.
   * Además desactiva sus suscripciones de webhook y cancela (DLQ, no se borran)
   * las entregas pendientes. NO toca workflows de Temporal ni datos.
   */
  async suspendTenant(idOrSlug: string, actor = 'platform_admin') {
    const t = await this.findTenant(idOrSlug);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { active: false } });
      const subs = await tx.webhookSubscription.updateMany({
        where: { tenantId: { in: [t.id, t.slug] }, active: true },
        data: { active: false },
      });
      const deliveries = await tx.webhookDelivery.updateMany({
        where: {
          status: { in: ['PENDIENTE', 'FALLIDO'] },
          subscription: { tenantId: { in: [t.id, t.slug] } },
        },
        data: { status: 'DLQ', lastError: 'tenant_suspended' },
      });
      return { webhooksPaused: subs.count, deliveriesCancelled: deliveries.count };
    });
    await this.auditLifecycle('TENANT_SUSPENDED', t, actor, result);
    return { ok: true, tenant: t.slug, active: false, ...result };
  }

  /** Reactiva el tenant. Los webhooks siguen pausados: reactivarlos es decisión del tenant. */
  async reactivateTenant(idOrSlug: string, actor = 'platform_admin') {
    const t = await this.findTenant(idOrSlug);
    await this.prisma.tenant.update({ where: { id: t.id }, data: { active: true } });
    await this.auditLifecycle('TENANT_REACTIVATED', t, actor, {});
    return { ok: true, tenant: t.slug, active: true };
  }

  private async auditLifecycle(
    action: string,
    t: { id: string; slug: string },
    actor: string,
    payload: Record<string, unknown>,
  ) {
    try {
      await this.audit?.append({ actorId: actor, action, tenantId: t.slug, payload: { tenantId: t.id, ...payload } });
    } catch (e) {
      // La auditoría no debe revertir la suspensión (ya aplicada): queda constancia en el log.
      this.log.error(`Auditoría de ${action} falló para ${t.slug}: ${(e as Error).message}`);
    }
  }

  private async findTenant(idOrSlug: string) {
    const t =
      (await this.prisma.tenant.findUnique({ where: { id: idOrSlug } })) ??
      (await this.prisma.tenant.findUnique({ where: { slug: idOrSlug } }));
    if (!t) throw new NotFoundException(`Tenant ${idOrSlug} no encontrado`);
    return t;
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

  /**
   * `admin` es un rol de realm de Keycloak, no está acotado por tenant: un
   * admin solo administra SU tenant. Solo el operador de plataforma
   * (rol explícito `platform_admin` en el token) administra cualquier tenant;
   * ser del tenant 'seguridata' ya NO concede ese poder.
   */
  async assertOwnTenant(
    tenantIdOrSlug: string,
    caller: { tenantId: string; roles?: string[] },
  ): Promise<void> {
    if (isPlatformAdmin(caller)) return;
    const t =
      (await this.prisma.tenant.findUnique({ where: { id: tenantIdOrSlug } })) ??
      (await this.prisma.tenant.findUnique({ where: { slug: tenantIdOrSlug } }));
    if (!t) throw new NotFoundException(`Tenant ${tenantIdOrSlug} no encontrado`);
    if (t.id !== caller.tenantId && t.slug !== caller.tenantId) {
      throw new ForbiddenException('No puedes administrar un tenant distinto al tuyo');
    }
  }

  // ---- Membresías ----
  async listMembers(tenantIdOrSlug: string, page?: PageQueryDto) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    const args = pageArgs(page);
    // Orden de dominio estable (userId asc, id asc); el cursor sigue siendo el id.
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
      ...prismaPage(args),
    });
    return finishPage(rows, args);
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
  async listPolicies(tenantIdOrSlug: string, page?: PageQueryDto) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    const args = pageArgs(page);
    const rows = await this.prisma.policy.findMany({
      where: { tenantId },
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      ...prismaPage(args),
    });
    return finishPage(rows, args);
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
  async listCatalog(tenantIdOrSlug: string, kind?: string, page?: PageQueryDto) {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
    const args = pageArgs(page);
    const rows = await this.prisma.catalogEntry.findMany({
      where: { tenantId, kind: kind || undefined },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      ...prismaPage(args),
    });
    return finishPage(rows, args);
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
