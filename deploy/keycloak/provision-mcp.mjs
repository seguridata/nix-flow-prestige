import { pathToFileURL } from 'node:url';

export function mcpClientConfig(env) {
  const resource = new URL(env.MCP_RESOURCE_URL || 'http://localhost:3000/mcp');
  if (resource.pathname !== '/mcp' || resource.search || resource.hash || resource.username || resource.password) throw new Error('MCP_RESOURCE_URL inválido');
  const redirects = (env.MCP_REDIRECT_URIS || 'http://127.0.0.1:9321/callback,http://localhost:9321/callback').split(',').map(x => x.trim());
  for (const raw of [resource.href, ...redirects]) {
    const u = new URL(raw);
    if (raw.includes('*') || u.username || u.password || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('URLs exactas HTTPS (o loopback local) requeridas');
  }
  return {
    clientId: 'prestige-mcp-client', name: 'Prestige MCP', protocol: 'openid-connect', enabled: true,
    publicClient: true, standardFlowEnabled: true, implicitFlowEnabled: false,
    directAccessGrantsEnabled: false, serviceAccountsEnabled: false, consentRequired: true,
    fullScopeAllowed: false, redirectUris: redirects, webOrigins: [...new Set(redirects.map(x => new URL(x).origin))],
    attributes: { 'pkce.code.challenge.method': 'S256', 'oauth2.device.authorization.grant.enabled': 'false', 'backchannel.logout.session.required': 'true', 'access.token.lifespan': '300' },
    defaultClientScopes: ['roles', 'profile'], optionalClientScopes: ['prestige:read'],
    protocolMappers: [
      { name: 'tenant', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-attribute-mapper', consentRequired: false, config: { 'user.attribute': 'tenant', 'claim.name': 'tenant', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false' } },
    ],
  };
}

export async function provisionMcp(env, args, request = fetch) {
  const config = mcpClientConfig(env);
  if (!args.includes('--apply')) return { dryRun: true, clientId: config.clientId, redirectUris: config.redirectUris, resource: env.MCP_RESOURCE_URL || 'http://localhost:3000/mcp' };
  if (!args.includes('--sandbox')) throw new Error('Aplicación automática solo con --sandbox explícito');
  const base = new URL(env.KEYCLOAK_URL || 'http://localhost:8081');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error('Provisionamiento automático solo Keycloak local');
  if (!env.KEYCLOAK_ADMIN_PASSWORD) throw new Error('KEYCLOAK_ADMIN_PASSWORD requerida');
  const auth = await request(`${base.origin}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: env.KEYCLOAK_ADMIN_USER || 'admin', password: env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (!auth.ok) throw new Error(`Keycloak admin HTTP ${auth.status}`);
  const token = (await auth.json()).access_token;
  const api = async (path, method = 'GET', body) => {
    const response = await request(`${base.origin}/admin/realms/prestige${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Keycloak HTTP ${response.status}: ${method} ${path}`);
    const text = await response.text(); return text ? JSON.parse(text) : undefined;
  };
  let scope = (await api('/client-scopes')).find(s => s.name === 'prestige:read');
  const scopeBody = { name: 'prestige:read', description: 'Consultar procesos, formatos y mis solicitudes de Prestige', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'true', 'consent.screen.text': 'Consultar procesos, formatos y mis solicitudes (solo lectura)' }, protocolMappers: [{ name: 'prestige-mcp-resource-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', consentRequired: false, config: { 'included.custom.audience': env.MCP_AUDIENCE || env.MCP_RESOURCE_URL || 'http://localhost:3000/mcp', 'access.token.claim': 'true', 'id.token.claim': 'false' } }] };
  if (!scope) { await api('/client-scopes', 'POST', scopeBody); scope = (await api('/client-scopes')).find(s => s.name === scopeBody.name); }
  else {
    await api(`/client-scopes/${scope.id}`, 'PUT', { ...scope, ...scopeBody });
    const mappers = await api(`/client-scopes/${scope.id}/protocol-mappers/models`);
    for (const mapper of scopeBody.protocolMappers) {
      const existing = mappers.find(m => m.name === mapper.name);
      await api(`/client-scopes/${scope.id}/protocol-mappers/models${existing ? `/${existing.id}` : ''}`, existing ? 'PUT' : 'POST', { ...mapper, ...(existing ? { id: existing.id } : {}) });
    }
  }
  let client = (await api('/clients?clientId=prestige-mcp-client')).find(c => c.clientId === config.clientId);
  await api(client ? `/clients/${client.id}` : '/clients', client ? 'PUT' : 'POST', { ...config, ...(client ? { id: client.id } : {}) });
  client = (await api('/clients?clientId=prestige-mcp-client')).find(c => c.clientId === config.clientId);
  await api(`/clients/${client.id}/optional-client-scopes/${scope.id}`, 'PUT');
  // With fullScopeAllowed=false explicitly permit only the existing business realm roles.
  const roles = (await api('/roles')).filter(r => ['admin', 'sender', 'signer', 'platform_admin'].includes(r.name));
  await api(`/clients/${client.id}/scope-mappings/realm`, 'POST', roles);
  return { provisioned: true, clientId: config.clientId, pkce: 'S256', passwordGrant: false, consentRequired: true, resource: env.MCP_RESOURCE_URL || 'http://localhost:3000/mcp', redirectUris: config.redirectUris };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionMcp(process.env, process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
