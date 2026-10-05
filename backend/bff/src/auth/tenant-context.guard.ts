import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Elige el tenant de la petición.
 *
 * Header `X-Tenant-Id` (id o slug). Si no viene, se queda el claim del token.
 * El usuario tiene que pertenecer a ese tenant (`TenantMembership`). Sin
 * filas se RECHAZA (fail-closed), salvo `ALLOW_UNMAPPED_TENANT=true` fuera de
 * producción (solo dev, antes de sembrar membresías).
 *
 * El `tenantId` que queda en el usuario es el slug: es el valor que ya
 * guardan `Case` y `Document`.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return true;

    const header = headerValue(request.headers?.['x-tenant-id']);
    const requested = header || user.tenantId;
    const userIds = [...new Set([user.actorId, user.sub].filter((v) => v && v.length > 0))];

    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId: { in: userIds }, active: true },
      include: { tenant: true },
    });

    if (memberships.length === 0) {
      // Fail-closed: un directorio vacío ya no abre el sandbox. Solo con
      // ALLOW_UNMAPPED_TENANT=true Y fuera de producción se acepta el claim.
      const allowUnmapped =
        process.env.ALLOW_UNMAPPED_TENANT === 'true' && process.env.NODE_ENV !== 'production';
      if (!allowUnmapped) {
        throw new ForbiddenException('Usuario sin membresía de tenant');
      }
      if (header && header !== user.tenantId) {
        throw new ForbiddenException('Sin membresía en ese tenant');
      }
      return true;
    }

    const match = memberships.find(
      (m) =>
        m.tenant.active &&
        (m.tenant.slug === requested || m.tenant.id === requested || m.tenantId === requested),
    );
    if (!match) {
      throw new ForbiddenException('Sin membresía en ese tenant');
    }

    user.tenantId = match.tenant.slug;
    return true;
  }
}

function headerValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}
