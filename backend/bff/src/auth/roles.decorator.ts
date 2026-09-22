import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requiredRoles';

/**
 * Exige que el usuario autenticado tenga AL MENOS UNO de los roles indicados
 * (roles de realm de Keycloak). Se combina con `JwtAuthGuard` (que ya puso
 * `request.user`) mediante `RolesGuard`, registrado como APP_GUARD.
 *
 *   @Roles('rh', 'admin')
 *   @Post(':id/actions/enable')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
