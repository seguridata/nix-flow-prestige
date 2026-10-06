import { describe, expect, it } from 'vitest';
import { parseBootstrapArgs } from '../../prisma/scripts/bootstrap-tenant.lib';

describe('parseBootstrapArgs', () => {
  it('args válidos con roles por defecto y --dry-run', () => {
    const r = parseBootstrapArgs(['--tenant', 'acme', '--user-id', 'ana', '--dry-run']);
    expect(r).toEqual({
      ok: true,
      options: {
        tenant: 'acme',
        userId: 'ana',
        roles: ['admin', 'sender', 'signer'],
        name: null,
        email: null,
        tenantName: 'acme',
        dryRun: true,
      },
    });
  });

  it('acepta --k=v, roles con espacios/duplicados y separador --', () => {
    const r = parseBootstrapArgs(['--', '--tenant=acme', '--user-id=ana', '--roles=admin, signer,admin', '--name=Ana']);
    expect(r.ok && r.options.roles).toEqual(['admin', 'signer']);
    expect(r.ok && r.options.name).toBe('Ana');
  });

  it('toma valores del entorno y el CLI los pisa', () => {
    const r = parseBootstrapArgs(['--tenant', 'cli'], { BOOTSTRAP_TENANT: 'env', BOOTSTRAP_USER_ID: 'u1' });
    expect(r.ok && r.options.tenant).toBe('cli');
    expect(r.ok && r.options.userId).toBe('u1');
  });

  it('falta tenant y user-id', () => {
    const r = parseBootstrapArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/--tenant.*--user-id/s);
  });

  it('slug inválido, rol desconocido, correo inválido y argumento desconocido', () => {
    const r = parseBootstrapArgs([
      '--tenant', 'Acme Corp', '--user-id', 'ana', '--roles', 'admin,root', '--email', 'x', '--foo',
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const t = r.errors.join('\n');
      expect(t).toMatch(/slug válido/);
      expect(t).toMatch(/root/);
      expect(t).toMatch(/correo válido/);
      expect(t).toMatch(/--foo/);
    }
  });

  it('valor faltante tras un flag', () => {
    const r = parseBootstrapArgs(['--tenant', '--user-id', 'ana']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Falta el valor de --tenant/);
  });

  it('--help', () => {
    expect(parseBootstrapArgs(['--help'])).toMatchObject({ ok: false, help: true });
  });
});
