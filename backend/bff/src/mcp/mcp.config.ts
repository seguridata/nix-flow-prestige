/** Never derive OAuth URLs from untrusted Host / forwarded headers. */
export function mcpConfig() {
  const enabled = process.env.MCP_ENABLED === 'false' ? false : process.env.MCP_ENABLED === 'true' || process.env.NODE_ENV !== 'production' || !!process.env.MCP_RESOURCE_URL;
  if (!enabled) return { enabled: false, reason: 'MCP no está habilitado en este entorno', resource: '', issuer: '', audience: '', metadata: '', origins: new Set<string>(), scope: 'prestige:read' };
  if (process.env.NODE_ENV === 'production' && (!process.env.MCP_RESOURCE_URL || !process.env.KEYCLOAK_ISSUER)) throw new Error('MCP habilitado requiere MCP_RESOURCE_URL y KEYCLOAK_ISSUER en producción');
  const resource = new URL(process.env.MCP_RESOURCE_URL ?? 'http://localhost:3000/mcp');
  const issuer = new URL(process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8081/realms/prestige');
  for (const url of [resource, issuer]) {
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('MCP requiere URLs HTTPS; HTTP solo está permitido en loopback');
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('MCP requiere HTTPS en producción');
  }
  if (resource.pathname !== '/mcp') throw new Error('MCP_RESOURCE_URL debe terminar en /mcp');
  return {
    enabled: true,
    reason: undefined,
    resource: resource.href,
    issuer: issuer.href.replace(/\/$/, ''),
    audience: process.env.MCP_AUDIENCE?.trim() || resource.href,
    metadata: `${resource.origin}/.well-known/oauth-protected-resource/mcp`,
    origins: new Set([resource.origin, ...(process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean)]),
    scope: 'prestige:read',
  };
}
