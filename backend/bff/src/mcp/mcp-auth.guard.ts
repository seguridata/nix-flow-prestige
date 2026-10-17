import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-guard';
import { mcpConfig } from './mcp.config';

export function validateMcpClaims(payload: JWTPayload, audience: string): { actorId: string; tenantId: string; roles: string[] } {
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  // azp is NOT a resource audience. Regular web tokens must not work here.
  if (!aud.includes(audience) || !payload.sub || typeof payload.exp !== 'number') throw new UnauthorizedException('Token no emitido para este recurso MCP');
  if (typeof payload.scope !== 'string' || !payload.scope.split(/\s+/).includes('prestige:read')) throw new ForbiddenException('Scope prestige:read requerido');
  if (typeof payload.tenant !== 'string' || !payload.tenant.trim()) throw new ForbiddenException('Token sin tenant');
  const realm = payload.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(realm?.roles) ? realm.roles.filter((r): r is string => typeof r === 'string') : [];
  if (!roles.some(r => ['admin', 'sender', 'signer', 'platform_admin'].includes(r))) throw new ForbiddenException('Rol de Prestige requerido');
  return { actorId: typeof payload.preferred_username === 'string' ? payload.preferred_username : payload.sub, tenantId: payload.tenant.trim(), roles };
}

@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly config = mcpConfig();
  private readonly jwks = this.config.enabled ? createRemoteJWKSet(new URL(`${this.config.issuer}/protocol/openid-connect/certs`)) : undefined;
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    res.setHeader('Cache-Control', 'no-store');
    if (!this.config.enabled || !this.jwks) throw new ServiceUnavailableException('MCP no está habilitado en este entorno');
    const challenge = `Bearer resource_metadata="${this.config.metadata}", scope="prestige:read"`;
    res.setHeader('WWW-Authenticate', challenge);
    const origin = req.headers.origin;
    if (origin && (typeof origin !== 'string' || !this.config.origins.has(origin))) throw new ForbiddenException('Origin MCP no autorizado');
    const match = typeof req.headers.authorization === 'string' ? /^Bearer ([^\s]+)$/.exec(req.headers.authorization) : null;
    if (!match) throw new UnauthorizedException('Autorización OAuth requerida');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(match[1], this.jwks, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256', 'PS256', 'ES256'] }));
    } catch { throw new UnauthorizedException('Token OAuth inválido o expirado'); }
    let identity: ReturnType<typeof validateMcpClaims>;
    try { identity = validateMcpClaims(payload, this.config.audience); }
    catch (error) {
      if (error instanceof ForbiddenException) res.setHeader('WWW-Authenticate', `${challenge}, error="insufficient_scope"`);
      throw error;
    }
    const requested = typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'].trim() : identity.tenantId;
    const memberships = await runAsSystem('resolver membresía OAuth MCP del usuario autenticado', () => this.prisma.tenantMembership.findMany({
      where: { userId: { in: [identity.actorId, payload.sub!] }, active: true }, include: { tenant: true },
    }));
    const membership = memberships.find(m => m.tenant.active && (m.tenant.slug === requested || m.tenant.id === requested));
    if (!membership || !membership.roles.some(r => identity.roles.includes(r) && ['admin', 'sender', 'signer', 'platform_admin'].includes(r))) throw new ForbiddenException('Sin membresía activa en ese tenant');
    req.user = { sub: payload.sub!, actorId: identity.actorId, tenantId: membership.tenant.slug, roles: membership.roles.filter(r => identity.roles.includes(r)), raw: payload } satisfies AuthenticatedUser;
    res.removeHeader('WWW-Authenticate');
    return true;
  }
}
