import { pathToFileURL } from 'node:url';

// Identidades existentes verificadas en la matriz; nuevos usernames internos para las altas aprobadas.
export const USERS = [
  { username: 'ayarza', firstName: 'Alberto', lastName: 'Yarza', email: 'ayarza@seguridata.com' },
  { username: 'bcalatayud', firstName: 'Bernardo', lastName: 'Calatayud', email: 'bcalatayud@seguridata.com' },
  { username: 'jalarcon', firstName: 'Javier', lastName: 'Alarcón', email: 'jalarcon@seguridata.com' },
  { username: 'javazquez', firstName: 'Jesús', lastName: 'Vázquez', email: 'javazquez@seguridata.com' },
  { username: 'maramirez', firstName: 'Margarita', lastName: 'Ramírez', email: 'maramirez@seguridata.com' },
  { username: 'ogarcia', firstName: 'Olga', lastName: 'García', email: 'ogarcia@seguridata.com' },
  { username: 'adiaz', firstName: 'Alejandro', lastName: 'Díaz' },
  { username: 'ajimenez', firstName: 'Alejandro', lastName: 'Jiménez' },
  { username: 'draygoza', firstName: 'David', lastName: 'Raygoza', email: 'draygoza@seguridata.com', master: true },
];
export function sandboxUrl(raw) {
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Solo sandbox local, sin credenciales en URL');
  return url.href.replace(/\/$/, '');
}
export async function provision(env, args = [], request = fetch) {
  const allowed = ['--apply', '--delete-fictitious', '--sandbox'];
  if (args.some(a => !allowed.includes(a))) throw new Error('Opciones: --apply --sandbox [--delete-fictitious]');
  if (!args.includes('--sandbox')) throw new Error('Requiere --sandbox explícito');
  const base = sandboxUrl(env.KEYCLOAK_URL || 'http://localhost:8080');
  const realm = env.KEYCLOAK_REALM || 'prestige';
  if (realm !== 'prestige') throw new Error('Solo realm prestige del sandbox');
  const apply = args.includes('--apply');
  if (!apply) return { dryRun: true, users: USERS.map(u => u.username), delete: args.includes('--delete-fictitious') ? ['maria', 'roberto', 'carlos'] : [] };
  if (!env.KEYCLOAK_ADMIN_PASSWORD || !env.PRESTIGE_USER_PASSWORD) throw new Error('Requiere KEYCLOAK_ADMIN_PASSWORD y PRESTIGE_USER_PASSWORD en entorno');
  const response = await request(`${base}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN_USER || 'admin', password: env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (!response.ok) throw new Error(`Autenticación Keycloak: HTTP ${response.status}`);
  const { access_token } = await response.json();
  const api = async (path, method = 'GET', body) => {
    const r = await request(`${base}/admin/realms/${realm}${path}`, { method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${r.status}`);
    return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.text().then(t => t ? JSON.parse(t) : null);
  };
  // En sandbox no inventamos correo para las dos altas cuyo correo no fue proporcionado.
  // Mantener validación de formato; únicamente quitar obligatoriedad global de email.
  const profileConfig = await api('/users/profile');
  const emailAttribute = profileConfig.attributes?.find(a => a.name === 'email');
  if (emailAttribute?.required) {
    delete emailAttribute.required;
    await api('/users/profile', 'PUT', profileConfig);
  }
  const roles = await api('/roles');
  const required = ['admin', 'signer', 'sender', 'platform_admin'];
  for (const name of required) if (!roles.some(r => r.name === name)) throw new Error(`Falta rol ${name}`);
  for (const u of USERS) {
    let found = await api(`/users?username=${u.username}&exact=true`);
    if (found.length > 1) throw new Error(`Usuario ambiguo: ${u.username}`);
    if (found[0] && found[0].attributes?.tenant?.[0] !== 'seguridata') throw new Error(`Usuario ${u.username} pertenece a otro tenant o carece de tenant`);
    const { master, ...identity } = u;
    const profile = { ...identity, enabled: true, attributes: { ...(found[0]?.attributes || {}), tenant: ['seguridata'] } };
    if (!found.length) {
      await api('/users', 'POST', { ...profile, credentials: [{ type: 'password', value: env.PRESTIGE_USER_PASSWORD, temporary: false }] });
      found = await api(`/users?username=${u.username}&exact=true`);
    } else await api(`/users/${found[0].id}`, 'PUT', profile);
    if (!found[0]?.id) throw new Error(`No se verificó alta ${u.username}`);
    // Reejecutar no cambia contraseñas de usuarios existentes.
    await api(`/users/${found[0].id}/role-mappings/realm`, 'POST', roles.filter(r => ['admin', 'signer', 'sender', ...(master ? ['platform_admin'] : [])].includes(r.name)));
  }
  if (args.includes('--delete-fictitious')) {
    for (const username of ['maria', 'roberto', 'carlos']) {
      const found = await api(`/users?username=${username}&exact=true`);
      if (found.length > 1) throw new Error(`Usuario ambiguo: ${username}`);
      if (found[0]) {
        if (found[0].attributes?.tenant?.[0] !== 'seguridata') throw new Error(`No se elimina ${username}: tenant inesperado`);
        await api(`/users/${found[0].id}`, 'DELETE');
      }
    }
  }
  return { provisioned: USERS.map(u => u.username), deletedFictitious: args.includes('--delete-fictitious') };
}
export async function syncMemberships(prisma) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'seguridata' } });
  if (!tenant?.active) throw new Error('Falta tenant seguridata activo');
  for (const u of USERS) {
    const data = { name: `${u.firstName} ${u.lastName}`, email: u.email ?? null, active: true, roles: ['admin', 'signer', 'sender', ...(u.master ? ['platform_admin'] : [])] };
    await prisma.tenantMembership.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: u.username } }, create: { tenantId: tenant.id, userId: u.username, ...data }, update: data });
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--apply')) return provision(process.env, args);
  if (!process.env.DATABASE_URL) throw new Error('Requiere DATABASE_URL para membresias');
  const dbUrl = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname) || dbUrl.pathname !== '/prestige') throw new Error('Solo base prestige local');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: 'seguridata' } });
    if (!tenant?.active) throw new Error('Falta tenant seguridata activo');
    const result = await provision(process.env, args);
    await syncMemberships(prisma);
    if (args.includes('--delete-fictitious')) await prisma.tenantMembership.updateMany({ where: { tenantId: tenant.id, userId: { in: ['maria', 'roberto', 'carlos'] } }, data: { active: false } });
    return result;
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
