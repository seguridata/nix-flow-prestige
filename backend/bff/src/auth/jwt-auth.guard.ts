import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Claims que nos interesan del access token de Keycloak, ya normalizados
 * para el resto del backend. Keycloak agrega roles de realm bajo
 * `realm_access.roles` (no es un claim estándar de OIDC, es propio de KC).
 */
export interface AuthenticatedUser {
  sub: string;
  preferredUsername?: string;
  name?: string;
  email?: string;
  /** Identidad de negocio: hoy = preferred_username (los usuarios del realm son maria/carlos/roberto). */
  actorId: string;
  tenantId: string;
  roles: string[];
  /** `auth_time` del token (epoch s): cuándo se autenticó el usuario. Para `A-11` step-up. */
  authTime?: number;
  raw: JWTPayload;
}

interface KeycloakAccessToken extends JWTPayload {
  preferred_username?: string;
  name?: string;
  email?: string;
  tenant?: string;
  auth_time?: number;
  realm_access?: { roles?: string[] };
}

/**
 * Guard global de autenticación contra Keycloak (realm "prestige").
 *
 * Verifica el access token (Bearer) usando las llaves públicas del realm
 * (JWKS), obtenidas y cacheadas automáticamente por `createRemoteJWKSet`
 * desde KEYCLOAK_ISSUER + "/protocol/openid-connect/certs".
 *
 * Se registra como APP_GUARD en AuthModule, por lo que protege TODAS las
 * rutas por default. Las rutas marcadas con @Public() (ver public.decorator.ts)
 * se saltan la verificación — hoy eso incluye prácticamente todos los
 * endpoints existentes, porque el frontend todavía no implementa el login
 * real contra Keycloak. La lógica de verificación en sí es real y funcional:
 * quitar @Public() de una ruta activa su protección de inmediato.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  private readonly issuer = process.env.KEYCLOAK_ISSUER;

  // createRemoteJWKSet cachea el JWKS internamente (y refresca ante un
  // kid desconocido), así que basta con una sola instancia para todo
  // el ciclo de vida del proceso.
  private readonly jwks = this.issuer
    ? createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`))
    : undefined;

  constructor(private readonly reflector: Reflector) {
    if (!this.issuer) {
      this.logger.warn(
        'KEYCLOAK_ISSUER no está definido: todas las rutas no marcadas @Public() fallarán con 401.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractBearerToken(request.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('Falta el header Authorization: Bearer <token>');
    }
    if (!this.issuer || !this.jwks) {
      throw new UnauthorizedException('KEYCLOAK_ISSUER no configurado en el servidor');
    }

    try {
      const { payload } = await jwtVerify<KeycloakAccessToken>(token, this.jwks, {
        issuer: this.issuer,
      });

      request.user = {
        sub: payload.sub ?? '',
        preferredUsername: payload.preferred_username,
        name: payload.name,
        email: payload.email,
        actorId: payload.preferred_username ?? payload.sub ?? '',
        tenantId: payload.tenant ?? 'seguridata',
        roles: payload.realm_access?.roles ?? [],
        authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
        raw: payload,
      } satisfies AuthenticatedUser;

      return true;
    } catch (err) {
      this.logger.debug(`Verificación de JWT fallida: ${(err as Error).message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractBearerToken(authorizationHeader?: string): string | undefined {
    if (!authorizationHeader) return undefined;
    const [scheme, token] = authorizationHeader.split(' ');
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
