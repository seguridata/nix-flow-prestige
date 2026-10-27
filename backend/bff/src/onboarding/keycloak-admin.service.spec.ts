/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountConflictError, KeycloakAdminService } from './keycloak-admin.service';

const ENV = {
  KEYCLOAK_ISSUER: 'https://auth.example.test/realms/prestige',
  KEYCLOAK_ADMIN_CLIENT_ID: 'svc',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret-de-prueba',
  ONBOARDING_DEFAULT_PASSWORD: 'temporal-de-prueba',
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...(init.headers as object) }, ...init });

describe('KeycloakAdminService', () => {
  let calls: { url: string; init: RequestInit }[];
  let respond: (url: string, init: RequestInit) => Response | Promise<Response>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [...Object.keys(ENV), 'KEYCLOAK_ADMIN_URL', 'ONBOARDING_ACCOUNT_ROLES']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, ENV);
    calls = [];
    respond = () => json({}, { status: 500 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/protocol/openid-connect/token')) return json({ access_token: 'tok', expires_in: 300 });
        return respond(String(url), init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const account = { username: 'mperez', email: 'm@x.mx', firstName: 'Maya', lastName: 'Perez', tenant: 'seguridata' };

  it('está apagado si falta cualquier variable', () => {
    const svc = new KeycloakAdminService();
    expect(svc.enabled).toBe(true);
    delete process.env.ONBOARDING_DEFAULT_PASSWORD;
    expect(svc.enabled).toBe(false);
    process.env.ONBOARDING_DEFAULT_PASSWORD = 'x';
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    expect(svc.enabled).toBe(false);
  });

  it('pide el token con client credentials en el realm del issuer y lo reutiliza', async () => {
    respond = () => json([]);
    const svc = new KeycloakAdminService();
    await svc.usernameExists('a');
    await svc.usernameExists('b');
    const tokenCalls = calls.filter((c) => c.url.endsWith('/protocol/openid-connect/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe('https://auth.example.test/realms/prestige/protocol/openid-connect/token');
    expect(String(tokenCalls[0].init.body)).toContain('grant_type=client_credentials');
  });

  it('usa KEYCLOAK_ADMIN_URL (red interna) en lugar del host público', async () => {
    process.env.KEYCLOAK_ADMIN_URL = 'http://prestige-keycloak:8080/';
    respond = () => json([]);
    await new KeycloakAdminService().usernameExists('a');
    expect(calls.every((c) => c.url.startsWith('http://prestige-keycloak:8080/'))).toBe(true);
  });

  it('usernameExists consulta exacto y devuelve si hay coincidencia', async () => {
    respond = () => json([{ id: '1' }]);
    expect(await new KeycloakAdminService().usernameExists('mperez')).toBe(true);
    expect(calls.at(-1)!.url).toContain('/admin/realms/prestige/users?username=mperez&exact=true');
    respond = () => json([]);
    expect(await new KeycloakAdminService().usernameExists('otro')).toBe(false);
  });

  it('createUser: contraseña temporal, tenant, correo verificado y roles por defecto', async () => {
    respond = (url, init) => {
      if (init.method === 'POST' && url.endsWith('/users')) return new Response(null, { status: 201, headers: { location: `${url}/kc-9` } });
      if (url.includes('/roles/')) return json({ id: `r-${url.split('/').pop()}`, name: url.split('/').pop() });
      return new Response(null, { status: 204 });
    };
    const out = await new KeycloakAdminService().createUser(account);
    expect(out).toEqual({ id: 'kc-9' });
    const create = JSON.parse(String(calls.find((c) => c.init.method === 'POST' && c.url.endsWith('/users'))!.init.body));
    expect(create).toMatchObject({
      username: 'mperez',
      enabled: true,
      emailVerified: true,
      attributes: { tenant: ['seguridata'] },
      credentials: [{ type: 'password', value: 'temporal-de-prueba', temporary: true }],
    });
    const mapping = calls.find((c) => c.url.endsWith('/users/kc-9/role-mappings/realm'))!;
    expect(JSON.parse(String(mapping.init.body)).map((r: any) => r.name)).toEqual(['sender', 'signer']);
  });

  it('409 distingue usuario repetido de correo repetido', async () => {
    respond = () => json({ errorMessage: 'User exists with same username' }, { status: 409 });
    await expect(new KeycloakAdminService().createUser(account)).rejects.toMatchObject({ field: 'username' });
    respond = () => json({ errorMessage: 'User exists with same email' }, { status: 409 });
    await expect(new KeycloakAdminService().createUser(account)).rejects.toBeInstanceOf(AccountConflictError);
    await expect(new KeycloakAdminService().createUser(account)).rejects.toMatchObject({ field: 'email' });
  });

  it('si falla la asignación de roles, borra la cuenta recién creada', async () => {
    respond = (url, init) => {
      if (init.method === 'POST' && url.endsWith('/users')) return new Response(null, { status: 201, headers: { location: `${url}/kc-9` } });
      if (url.includes('/roles/')) return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    };
    await expect(new KeycloakAdminService().createUser(account)).rejects.toThrow(/rol/);
    expect(calls.some((c) => c.init.method === 'DELETE' && c.url.endsWith('/users/kc-9'))).toBe(true);
  });

  it('disableUser reenvía la representación completa con enabled=false', async () => {
    respond = (_url, init) =>
      init.method === 'PUT' ? new Response(null, { status: 204 }) : json({ id: 'kc-9', username: 'mperez', attributes: { tenant: ['seguridata'] }, enabled: true });
    await new KeycloakAdminService().disableUser('kc-9');
    const put = calls.find((c) => c.init.method === 'PUT')!;
    expect(JSON.parse(String(put.init.body))).toMatchObject({ username: 'mperez', attributes: { tenant: ['seguridata'] }, enabled: false });
  });

  it('disableUser de una cuenta que ya no existe no es error', async () => {
    respond = () => new Response(null, { status: 404 });
    await expect(new KeycloakAdminService().disableUser('nada')).resolves.toBeUndefined();
  });
});
