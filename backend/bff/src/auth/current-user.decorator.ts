import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Extrae request.user (colocado ahí por JwtAuthGuard tras verificar el JWT)
 * para inyectarlo directamente como parámetro del handler.
 *
 * Uso:
 *   miEndpoint(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * En rutas @Public() sin token, request.user será undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
