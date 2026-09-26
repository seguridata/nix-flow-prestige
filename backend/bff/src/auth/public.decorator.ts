import { SetMetadata } from '@nestjs/common';

/**
 * Exenta la ruta de la verificación JWT de Keycloak (`JwtAuthGuard`).
 * No apaga `WorkerGuard` ni ningún otro guard puesto con `@UseGuards`.
 *
 * Criterio, ya cerrado: solo health, el texto de consentimiento, las
 * capacidades de firma, el verificador público del documento, el portal
 * del firmante con enlace de un solo uso, y el canal interno del worker
 * (ese último autentica con HMAC, no con Keycloak). Una ruta nueva no
 * lleva `@Public()` "por ahora".
 *
 * Uso:
 *   @Public()
 *   @Get()
 *   health() { ... }
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
