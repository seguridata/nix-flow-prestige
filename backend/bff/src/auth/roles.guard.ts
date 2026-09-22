import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Autorización por rol de realm. Se ejecuta después de `JwtAuthGuard`
 * (APP_GUARD): si la ruta es `@Public()` o no declara `@Roles(...)`, deja
 * pasar. Si declara roles, exige que `request.user.roles` contenga al menos
 * uno.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const roles = user?.roles ?? [];
    if (required.some((r) => roles.includes(r))) return true;

    throw new ForbiddenException(
      `Requiere uno de estos roles: ${required.join(', ')} (tienes: ${roles.join(', ') || 'ninguno'})`,
    );
  }
}
