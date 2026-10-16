import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from './prisma.service';

/** TTL de la caché slug|uuid → uuid. Los ids de tenant son inmutables; 5 min acota un alta/baja. */
export const TENANT_ID_CACHE_TTL_SECONDS = 300;

/**
 * ADR-004 / regla 5 de AGENTS.md: los modelos de negocio guardan el SLUG del tenant en
 * `tenantId`, pero `TenantMembership.tenantId` y `Policy.tenantId` guardan el UUID del
 * `Tenant`. Filtrar esas tablas por relación (`tenant: { OR: [...] }`) no fija la columna
 * `tenantId` y la guarda lo rechaza; este resolvedor traduce el valor que llega (slug o
 * uuid) al uuid para filtrar por la columna directamente.
 *
 * - Una consulta por las claves únicas de `Tenant` (el modelo `Tenant` no tiene columna
 *   `tenantId`, la guarda no lo vigila).
 * - Caché corta y SIN estado en el proceso: `RedisService.withCache` (compartida entre
 *   réplicas). Sin Redis o si falla, consulta directo. Lo inexistente no se cachea.
 */
@Injectable()
export class TenantIdResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** uuid del tenant, o `null` si el valor está vacío o no corresponde a ningún tenant. */
  async toId(slugOrId: string | null | undefined): Promise<string | null> {
    const value = typeof slugOrId === 'string' ? slugOrId.trim() : '';
    if (!value) return null;
    const load = async (): Promise<string | null> => {
      const row = await this.prisma.tenant.findFirst({
        where: { OR: [{ id: value }, { slug: value }] },
        select: { id: true },
      });
      return row?.id ?? null;
    };
    if (!this.redis) return load();
    return this.redis.withCache<string | null>(`tenant:id:${value}`, TENANT_ID_CACHE_TTL_SECONDS, load);
  }
}
