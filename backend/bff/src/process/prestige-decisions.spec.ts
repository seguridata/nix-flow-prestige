import { describe, expect, it, vi } from 'vitest';
import { validateFlow } from '../flow/flow';
import { ADQUISICIONES_FLOW } from './adquisiciones.flows';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { RESPONSABLES_TABLE } from '../../prisma/scripts/seed-example-gastos.lib';
// @ts-expect-error Operational ESM script, tested through its public functions.
import { decisionRows } from '../../prisma/scripts/apply-prestige-decisions.mjs';
// @ts-expect-error Operational ESM script.
import { provision, syncMemberships } from '../../prisma/scripts/provision-prestige-users.mjs';

describe('decisiones de responsables y solicitante autenticado', () => {
  const resolver = () => new FlowResolverService({ lookupTable: { findMany: vi.fn().mockResolvedValue([{ tenantId: 'seguridata', key: 'responsables-gasto', revision: 2, columns: RESPONSABLES_TABLE.columns, rows: decisionRows().map((values: unknown, position: number) => ({ tenantId: 'seguridata', id: `r${position}`, active: true, position, values })) }]) } } as any, {} as any);
  const values = { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 10, modalidadGasto: 'Reembolso' };
  it.each([['ogarcia','jalarcon'], ['adiaz','jalarcon'], ['bcalatayud','jalarcon'], ['maramirez','ayarza'], ['ajimenez','ayarza'], ['javazquez','ayarza']])('reembolso de %s se dirige a %s', async (solicitante, esperado) => {
    const r = await resolver().resolve(ADQUISICIONES_FLOW, values, 'seguridata', { solicitante });
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe(esperado);
  });
  it('no acepta suplantación en values; usa JWT incluso con nombre capturado distinto', async () => {
    const r = await resolver().resolve(ADQUISICIONES_FLOW, { ...values, solicitante: 'ogarcia' }, 'seguridata', { solicitante: 'ajimenez' });
    expect(r.values.solicitante).toBe('ajimenez');
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe('ayarza');
  });
  it('sin actor ignora identidad capturada y no activa regla personal', async () => {
    const r = await resolver().resolve(ADQUISICIONES_FLOW, { ...values, solicitante: 'ogarcia' }, 'seguridata');
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe('ajimenez');
  });
  it('compras normales conservan responsable de Marketing', async () => {
    const r = await resolver().resolve(ADQUISICIONES_FLOW, { ...values, modalidadGasto: 'Compra' }, 'seguridata', { solicitante: 'ogarcia' });
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe('ajimenez');
  });
  it.each(['Licencias y software: CRM', 'Aliados'])('%s corresponde a Alejandro Jiménez', async concepto => {
    const r = await resolver().resolve(ADQUISICIONES_FLOW, { ...values, concepto, tipoGasto: 'Bienes y servicios', modalidadGasto: 'Compra' }, 'seguridata', { solicitante: 'ogarcia' });
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe('ajimenez');
  });
  it('reserva solicitante ante variables editables y derivadas', () => {
    expect(validateFlow({ ...ADQUISICIONES_FLOW, variables: [...ADQUISICIONES_FLOW.variables, { key: 'solicitante', label: 'Falso', type: 'text', required: false }] }).join()).toContain('reservada');
    expect(validateFlow({ ...ADQUISICIONES_FLOW, derived: [{ key: 'solicitante', label: 'Falso', type: 'text' }] }).join()).toContain('ya existe');
  });
});
describe('provisionamiento seguro sandbox', () => {
  it('dry-run no hace llamadas ni necesita password', async () => {
    const fetcher = vi.fn();
    const r = await provision({}, ['--sandbox'], fetcher);
    expect(r.dryRun).toBe(true);
    expect(r.users).toContain('draygoza');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bloquea destinos remotos y falta de sandbox explícito', async () => {
    await expect(provision({}, [])).rejects.toThrow('sandbox');
    await expect(provision({ KEYCLOAK_URL: 'https://production.example' }, ['--sandbox'])).rejects.toThrow('local');
    await expect(provision({}, ['--sandbox', '--apply'])).rejects.toThrow('entorno');
  });
  it('membresías usan UUID del tenant y username; solo draygoza es platform_admin', async () => {
    const prisma = { tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-uuid', active: true }) }, tenantMembership: { upsert: vi.fn() } };
    await syncMemberships(prisma);
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledTimes(9);
    for (const [call] of prisma.tenantMembership.upsert.mock.calls as any[]) {
      expect(call.create.tenantId).toBe('tenant-uuid');
      expect(call.create.roles.includes('platform_admin')).toBe(call.create.userId === 'draygoza');
    }
  });
});

it('provisionamiento repetible conserva passwords existentes y no elimina ficticios por defecto', async () => {
  const users: any[] = [];
  let passwordWrites = 0;
  let deletes = 0;
  let emailRequired = true;
  const request = vi.fn(async (url: string, init: any) => {
    const path = new URL(url).pathname;
    const body = init.body instanceof URLSearchParams ? {} : JSON.parse(init.body || '{}');
    let result: any = {};
    if (path.endsWith('/token')) result = { access_token: 'test-token' };
    else if (path.endsWith('/users/profile')) {
      if (init.method === 'PUT') emailRequired = Boolean(body.attributes[0].required);
      else result = { attributes: [{ name: 'email', ...(emailRequired ? { required: { roles: ['user'] } } : {}), validations: { email: {} } }] };
    } else if (path.endsWith('/roles')) result = ['admin', 'signer', 'sender', 'platform_admin'].map(name => ({ id: name, name }));
    else if (path.endsWith('/users') && init.method === 'GET') result = users.filter(u => u.username === new URL(url).searchParams.get('username'));
    else if (path.endsWith('/users') && init.method === 'POST') { passwordWrites++; users.push({ ...body, id: body.username }); }
    else if (init.method === 'DELETE') deletes++;
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const env = { KEYCLOAK_ADMIN_PASSWORD: 'test-only', PRESTIGE_USER_PASSWORD: 'test-only' };
  await provision(env, ['--sandbox', '--apply'], request);
  await provision(env, ['--sandbox', '--apply'], request);
  expect(users).toHaveLength(9);
  expect(passwordWrites).toBe(9);
  expect(deletes).toBe(0);
  expect(emailRequired).toBe(false);
  expect(users.find(u => u.username === 'draygoza').email).toBe('draygoza@seguridata.com');
  expect(users.find(u => u.username === 'ajimenez').email).toBeUndefined();
});
