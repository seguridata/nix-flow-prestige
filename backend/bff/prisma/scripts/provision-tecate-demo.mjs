import { pathToFileURL } from 'node:url';

/**
 * Demo de multitenancy: un segundo tenant (Tecate) con su propio cliente OIDC de Keycloak
 * (que lleva su tema de login `prestige-tecate`), un grupo y UN solo usuario administrador.
 *
 * Aislamiento: el usuario lleva el atributo `tenant=tecate`, que el token expone como claim;
 * el BFF lo resuelve con TenantContextGuard y solo ve datos de ese tenant. El usuario recibe
 * únicamente el rol `admin` (no `platform_admin`) y no pertenece al tenant `seguridata`.
 * La membresía en Prestige se crea con `bun run bootstrap:tenant` (ver README del tema).
 *
 *   KEYCLOAK_ADMIN_PASSWORD=... TECATE_ADMIN_PASSWORD=... node provision-tecate-demo.mjs --sandbox --apply
 *
 * Sin --apply solo describe lo que haría. Idempotente: no cambia la contraseña de un usuario existente.
 */
export const TENANT = { slug: 'tecate', name: 'Tecate', clientId: 'prestige-web-tecate', theme: 'prestige-tecate', group: 'tecate' };
export const ADMIN = { username: 'tecate-admin', firstName: 'Administrador', lastName: 'Tecate', email: 'admin@tecate.example' };

export function sandboxUrl(raw) {
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Solo sandbox local, sin credenciales en URL');
  return url.href.replace(/\/$/, '');
}

/** Mismo cliente público que `prestige-web`, más el tema de login del tenant. */
export function clientRepresentation() {
  return {
    clientId: TENANT.clientId,
    name: 'Prestige Web — Tecate (demo)',
    enabled: true,
    publicClient: true,
    protocol: 'openid-connect',
    standardFlowEnabled: true,
    directAccessGrantsEnabled: true,
    redirectUris: ['http://localhost:3001/*', 'http://localhost:3000/*'],
    webOrigins: ['http://localhost:3001', 'http://localhost:3000'],
    attributes: { login_theme: TENANT.theme },
    protocolMappers: [
      { name: 'tenant', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-attribute-mapper', consentRequired: false, config: { 'user.attribute': 'tenant', 'claim.name': 'tenant', 'jsonType.label': 'String', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true' } },
      { name: 'auth_time', protocol: 'openid-connect', protocolMapper: 'oidc-usersessionmodel-note-mapper', consentRequired: false, config: { 'user.session.note': 'AUTH_TIME', 'claim.name': 'auth_time', 'jsonType.label': 'long', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'false' } },
    ],
  };
}

export async function provision(env, args = [], request = fetch) {
  const allowed = ['--apply', '--sandbox'];
  if (args.some(a => !allowed.includes(a))) throw new Error('Opciones: --sandbox [--apply]');
  if (!args.includes('--sandbox')) throw new Error('Requiere --sandbox explícito');
  const base = sandboxUrl(env.KEYCLOAK_URL || 'http://localhost:8080');
  const realm = env.KEYCLOAK_REALM || 'prestige';
  if (realm !== 'prestige') throw new Error('Solo realm prestige del sandbox');
  if (!args.includes('--apply')) return { dryRun: true, tenant: TENANT.slug, client: TENANT.clientId, theme: TENANT.theme, group: TENANT.group, user: ADMIN.username, roles: ['admin'] };
  if (!env.KEYCLOAK_ADMIN_PASSWORD || !env.TECATE_ADMIN_PASSWORD) throw new Error('Requiere KEYCLOAK_ADMIN_PASSWORD y TECATE_ADMIN_PASSWORD en entorno');

  const tokenResponse = await request(`${base}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN_USER || 'admin', password: env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (!tokenResponse.ok) throw new Error(`Autenticación Keycloak: HTTP ${tokenResponse.status}`);
  const { access_token } = await tokenResponse.json();
  const api = async (path, method = 'GET', body) => {
    const r = await request(`${base}/admin/realms/${realm}${path}`, { method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${r.status}`);
    return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.text().then(t => (t ? JSON.parse(t) : null));
  };

  // 1) Cliente OIDC del tenant con su tema de login.
  const rep = clientRepresentation();
  const clients = await api(`/clients?clientId=${TENANT.clientId}`);
  if (clients.length) await api(`/clients/${clients[0].id}`, 'PUT', { ...clients[0], ...rep, id: clients[0].id });
  else await api('/clients', 'POST', rep);

  // 2) Grupo del tenant.
  let group = (await api(`/groups?search=${TENANT.group}&exact=true`)).find(g => g.name === TENANT.group);
  if (!group) {
    await api('/groups', 'POST', { name: TENANT.group, attributes: { tenant: [TENANT.slug] } });
    group = (await api(`/groups?search=${TENANT.group}&exact=true`)).find(g => g.name === TENANT.group);
  }
  if (!group?.id) throw new Error('No se verificó el grupo del tenant');

  // 3) Un único usuario administrador, aislado en el tenant tecate.
  const roles = await api('/roles');
  const admin = roles.find(r => r.name === 'admin');
  if (!admin) throw new Error('Falta el rol admin');
  let found = await api(`/users?username=${ADMIN.username}&exact=true`);
  if (found.length > 1) throw new Error(`Usuario ambiguo: ${ADMIN.username}`);
  if (found[0] && found[0].attributes?.tenant?.[0] !== TENANT.slug) throw new Error(`Usuario ${ADMIN.username} pertenece a otro tenant o carece de tenant`);
  const profile = { ...ADMIN, enabled: true, emailVerified: true, attributes: { ...(found[0]?.attributes || {}), tenant: [TENANT.slug] } };
  if (!found.length) {
    await api('/users', 'POST', { ...profile, credentials: [{ type: 'password', value: env.TECATE_ADMIN_PASSWORD, temporary: false }] });
    found = await api(`/users?username=${ADMIN.username}&exact=true`);
  } else await api(`/users/${found[0].id}`, 'PUT', profile); // no toca la contraseña
  const id = found[0]?.id;
  if (!id) throw new Error('No se verificó el alta del administrador');
  await api(`/users/${id}/role-mappings/realm`, 'POST', [admin]);
  await api(`/users/${id}/groups/${group.id}`, 'PUT');
  return { provisioned: true, tenant: TENANT.slug, client: TENANT.clientId, theme: TENANT.theme, user: ADMIN.username, roles: ['admin'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) provision(process.env, process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
