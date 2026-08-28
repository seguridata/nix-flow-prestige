import { SetMetadata } from '@nestjs/common';

/**
 * Marca una ruta (o un controller completo) como pública, es decir, exenta
 * de la verificación de JWT que aplica JwtAuthGuard globalmente (ver
 * auth.module.ts, registrado como APP_GUARD).
 *
 * Uso:
 *   @Public()
 *   @Get()
 *   list() { ... }
 *
 * TODO Fase 2: a medida que el frontend incorpore el login real contra
 * Keycloak (prestige-web), ir retirando @Public() ruta por ruta.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
