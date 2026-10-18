import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { STEP_UP_KEY } from './step-up.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * A-11 — se registra como APP_GUARD después de `JwtAuthGuard`/`RolesGuard`.
 * Sólo actúa sobre rutas marcadas con `@StepUp()`.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  private readonly logger = new Logger(StepUpGuard.name);

  constructor(private readonly reflector: Reflector) {
    if (process.env.STEP_UP_ENFORCE !== 'true') {
      this.logger.warn(
        'STEP_UP_ENFORCE no está activo: las rutas @StepUp() NO exigen re-autenticación reciente cuando el token no trae auth_time. Actívalo en producción.',
      );
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const maxAge = this.reflector.getAllAndOverride<number>(STEP_UP_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!maxAge) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    const nowSec = Math.floor(Date.now() / 1000);

    // Sin `auth_time` en el token: si STEP_UP_ENFORCE=true exigimos step-up
    // (asumiendo que el mapper del realm ya lo emite); si no, lo tratamos como
    // reciente para no romper realms que aún no publican el claim.
    const enforce = process.env.STEP_UP_ENFORCE === 'true';
    const authAge = user?.authTime
      ? nowSec - user.authTime
      : enforce
        ? Number.POSITIVE_INFINITY
        : 0;
    if (authAge > maxAge) {
      throw new ForbiddenException({
        error: 'step_up_required',
        message: 'Esta acción requiere volver a autenticarte',
        maxAgeSeconds: maxAge,
        authAgeSeconds: Number.isFinite(authAge) ? authAge : null,
      });
    }
    return true;
  }
}
