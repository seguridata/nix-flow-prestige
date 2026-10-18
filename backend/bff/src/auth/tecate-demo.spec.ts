import { describe, expect, it } from 'vitest';
// @ts-expect-error Script ESM operativo, probado por sus funciones públicas.
import { ADMIN, TENANT, clientRepresentation, provision } from '../../prisma/scripts/provision-tecate-demo.mjs';

type Call = { path: string; method: string; body?: any };

/** Keycloak falso en memoria: registra las llamadas y responde lo mínimo. */
function fakeKeycloak(existingUserTenant?: string) {
  const calls: Call[] = [];
  const json = (data: unknown, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => data, text: async () => JSON.stringify(data) }) as any;
  const created = { client: false, group: false, user: false };
  const request = async (url: string, init: any = {}) => {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace('/admin/realms/prestige', '');
    const method = init.method ?? 'GET';
    if (url.includes('/protocol/openid-connect/token')) return json({ access_token: 'x' });
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path.startsWith('/clients') && method === 'GET') return json(created.client ? [{ id: 'c1', clientId: TENANT.clientId }] : []);
    if (path === '/clients' && method === 'POST') { created.client = true; return json({}, 201); }
    if (path.startsWith('/groups') && method === 'GET') return json(created.group ? [{ id: 'g1', name: TENANT.group }] : []);
    if (path === '/groups' && method === 'POST') { created.group = true; return json({}, 201); }
    if (path === '/roles') return json([{ id: 'r1', name: 'admin' }, { id: 'r2', name: 'platform_admin' }]);
    if (path.startsWith('/users?') && method === 'GET') {
      if (existingUserTenant) return json([{ id: 'u1', username: ADMIN.username, attributes: { tenant: [existingUserTenant] } }]);
      return json(created.user ? [{ id: 'u1', username: ADMIN.username, attributes: { tenant: [TENANT.slug] } }] : []);
    }
    if (path === '/users' && method === 'POST') { created.user = true; return json({}, 201); }
    return json(null, 204);
  };
  return { request, calls };
}

const env = { KEYCLOAK_URL: 'http://localhost:8081', KEYCLOAK_ADMIN_PASSWORD: 'a', TECATE_ADMIN_PASSWORD: 'b' };

describe('demo de tenant Tecate en Keycloak', () => {
  it('sin --apply solo describe y no llama a Keycloak', async () => {
    const r = await provision({}, ['--sandbox']);
    expect(r).toMatchObject({ dryRun: true, tenant: 'tecate', client: 'prestige-web-tecate', theme: 'prestige-tecate', user: 'tecate-admin', roles: ['admin'] });
  });

  it('exige --sandbox, solo localhost y las contraseñas por entorno', async () => {
    await expect(provision({}, [])).rejects.toThrow('sandbox');
    await expect(provision({ KEYCLOAK_URL: 'https://production.example' }, ['--sandbox'])).rejects.toThrow('local');
    await expect(provision({ KEYCLOAK_URL: 'http://localhost:8081' }, ['--sandbox', '--apply'])).rejects.toThrow('entorno');
    await expect(provision({ ...env, KEYCLOAK_REALM: 'master' }, ['--sandbox'])).rejects.toThrow('prestige');
  });

  it('el cliente lleva el tema, el mapper de tenant y las mismas URIs que prestige-web', () => {
    const c = clientRepresentation();
    expect(c.attributes.login_theme).toBe('prestige-tecate');
    expect(c.protocolMappers.map((m: any) => m.name)).toEqual(['tenant', 'auth_time']);
    expect(c.publicClient).toBe(true);
  });

  it('crea cliente, grupo y un único usuario con solo el rol admin y tenant=tecate', async () => {
    const k = fakeKeycloak();
    const r = await provision(env, ['--sandbox', '--apply'], k.request);
    expect(r).toMatchObject({ provisioned: true, roles: ['admin'] });
    const user = k.calls.find(c => c.path === '/users' && c.method === 'POST')!;
    expect(user.body.attributes.tenant).toEqual(['tecate']);
    const mapped = k.calls.find(c => c.path.endsWith('/role-mappings/realm'))!;
    expect(mapped.body.map((x: any) => x.name)).toEqual(['admin']); // nunca platform_admin
    expect(k.calls.filter(c => c.path === '/users' && c.method === 'POST')).toHaveLength(1);
  });

  it('repetirlo no recrea el usuario ni toca su contraseña', async () => {
    const k = fakeKeycloak();
    await provision(env, ['--sandbox', '--apply'], k.request);
    const before = k.calls.length;
    await provision(env, ['--sandbox', '--apply'], k.request);
    const second = k.calls.slice(before);
    expect(second.some(c => c.path === '/users' && c.method === 'POST')).toBe(false);
    expect(second.some(c => c.path === '/clients' && c.method === 'POST')).toBe(false);
    expect(second.find(c => c.path === '/users/u1' && c.method === 'PUT')?.body.credentials).toBeUndefined();
  });

  it('se niega si el usuario ya existe en otro tenant', async () => {
    const k = fakeKeycloak('seguridata');
    await expect(provision(env, ['--sandbox', '--apply'], k.request)).rejects.toThrow('otro tenant');
  });
});
